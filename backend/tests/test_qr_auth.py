import asyncio
import base64
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException
from pyrogram import errors, raw

from backend.app.auth import AuthFlow, AuthManager, persist_account
from backend.app.db import Account, Session
from backend.app.schemas import AuthParameters, Check2FA, SendCode, SignIn
from backend.app.security import attempts, decrypt, encrypt


def login_token(value=b"test-qr-token", expires=None):
    return raw.types.auth.LoginToken(expires=expires or int(time.time()) + 30, token=value)


def authorized():
    return raw.types.auth.LoginTokenSuccess(
        authorization=raw.types.auth.Authorization(user=raw.types.User(id=456))
    )


@pytest.fixture
def qr_client(monkeypatch):
    attempts.clear()
    client = SimpleNamespace(
        is_connected=False,
        is_initialized=False,
        ipv6=False,
        server_time=time.time(),
        invoke=AsyncMock(return_value=login_token()),
        add_handler=Mock(),
        check_password=AsyncMock(),
        dispatcher=SimpleNamespace(start=AsyncMock(), stop=AsyncMock()),
        storage=SimpleNamespace(
            **{
                name: AsyncMock()
                for name in ("dc_id", "server_address", "port", "auth_key", "user_id", "is_bot")
            }
        ),
        session=SimpleNamespace(stop=AsyncMock()),
        get_dc_option=AsyncMock(
            return_value=SimpleNamespace(ip_address="149.154.167.50", port=443)
        ),
        get_session=AsyncMock(return_value=SimpleNamespace(auth_key=b"new-dc-key")),
    )

    async def connect():
        client.is_connected = True

    async def disconnect():
        client.is_connected = False

    client.connect = AsyncMock(side_effect=connect)
    client.disconnect = AsyncMock(side_effect=disconnect)
    factory = Mock(return_value=client)
    monkeypatch.setattr("backend.app.auth.Client", factory)
    monkeypatch.setattr("backend.app.auth.get_api_config", lambda: (1234, "a" * 32))
    monkeypatch.setattr("backend.app.auth.get_setting", lambda key: "")
    saved = AsyncMock(return_value=42)
    monkeypatch.setattr("backend.app.auth.persist_account", saved)
    return client, factory, saved


async def begin(qr_client):
    manager = AuthManager()
    result = await manager.start_qr(AuthParameters(name="QR account"))
    key = result["flow_id"]
    return manager, key, manager.flows[key], result


async def test_qr_start_without_phone_and_polls_do_not_rotate_token(qr_client):
    client, factory, saved = qr_client
    manager, key, flow, result = await begin(qr_client)
    assert result["status"] == "QR_WAITING"
    encoded = base64.urlsafe_b64encode(b"test-qr-token").decode().rstrip("=")
    assert result["qr_url"] == "tg://login?token=" + encoded
    assert 0 < result["expires_in"] <= 30
    assert len(key) >= 32
    assert factory.call_args.kwargs["in_memory"] is True
    assert factory.call_args.kwargs["no_updates"] is False
    assert factory.call_args.kwargs["skip_updates"] is True
    assert factory.call_args.kwargs["api_id"] == 1234
    client.dispatcher.start.assert_awaited_once()
    for _ in range(3):
        assert (await manager.qr_status(key))["qr_url"] == result["qr_url"]
    client.invoke.assert_awaited_once()
    saved.assert_not_awaited()
    await manager.cancel(key)
    client.dispatcher.stop.assert_awaited_once()
    client.disconnect.assert_awaited_once()
    assert key not in manager.flows


async def test_custom_api_and_proxy_are_shared_with_qr(qr_client, monkeypatch):
    client, factory, _ = qr_client
    manager = AuthManager()
    monkeypatch.setattr(
        "backend.app.auth.get_setting", lambda key: encrypt("http://proxy.test:8080")
    )
    result = await manager.start_qr(AuthParameters(api_id=999, api_hash="b" * 32))
    assert factory.call_args.kwargs["api_id"] == 999
    assert factory.call_args.kwargs["api_hash"] == "b" * 32
    assert factory.call_args.kwargs["proxy"]["hostname"] == "proxy.test"
    await manager.cancel(result["flow_id"])
    result = await manager.start_qr(AuthParameters(proxy="socks5://own.test:1080"))
    assert factory.call_args.kwargs["proxy"]["hostname"] == "own.test"
    await manager.cancel(result["flow_id"])


async def test_expired_qr_refreshes_in_same_flow_without_extending_flow_lifetime(qr_client):
    client, _, _ = qr_client
    manager, key, flow, original = await begin(qr_client)
    created = flow.created
    flow.qr_deadline = time.monotonic() - 1
    client.invoke.return_value = login_token(b"replacement")
    result = await manager.qr_status(key)
    assert result["flow_id"] == key
    assert result["qr_url"] != original["qr_url"]
    assert flow.created == created
    assert client.invoke.await_count == 2
    flow.created -= 601
    with pytest.raises(HTTPException) as exc:
        await manager.qr_status(key)
    assert exc.value.status_code == 410
    await manager.cleanup()
    assert not manager.flows
    client.disconnect.assert_awaited_once()


async def test_login_update_authorizes_once_even_with_concurrent_or_retried_polls(qr_client):
    client, _, saved = qr_client
    manager, key, flow, _ = await begin(qr_client)
    handler = client.add_handler.call_args.args[0]
    await handler.callback(client, raw.types.UpdateLoginToken(), {}, {})
    client.invoke.return_value = authorized()
    results = await asyncio.gather(manager.qr_status(key), manager.qr_status(key))
    assert all(
        result["status"] == "AUTHORIZED" and result["account_id"] == 42 for result in results
    )
    saved.assert_awaited_once_with(client, flow.spec)
    client.storage.user_id.assert_awaited_once_with(456)
    client.storage.is_bot.assert_awaited_once_with(False)
    client.disconnect.assert_awaited_once()
    assert flow.qr_url == ""
    assert "qr_url" not in await manager.qr_status(key)
    await manager.cancel(key)


@pytest.mark.parametrize("needs_password", [False, True])
async def test_dc_migration_and_optional_2fa(qr_client, needs_password):
    client, _, saved = qr_client
    manager, key, flow, _ = await begin(qr_client)
    flow.qr_event.set()
    old_session = client.session
    client.invoke.side_effect = [
        raw.types.auth.LoginTokenMigrateTo(dc_id=4, token=b"migrate-token"),
        errors.SessionPasswordNeeded() if needs_password else authorized(),
    ]
    result = await manager.qr_status(key)
    old_session.stop.assert_awaited_once()
    client.get_session.assert_awaited_once_with(
        dc_id=4,
        server_address="149.154.167.50",
        port=443,
        export_authorization=False,
        temporary=True,
    )
    client.storage.auth_key.assert_awaited_once_with(b"new-dc-key")
    client.storage.dc_id.assert_awaited_once_with(4)
    imported = client.invoke.call_args.args[0]
    assert isinstance(imported, raw.functions.auth.ImportLoginToken)
    assert imported.token == b"migrate-token"
    if needs_password:
        assert result == {"status": "2FA_REQUIRED", "flow_id": key}
        saved.assert_not_awaited()
        # Status remains readable without another export while entering a password.
        assert await manager.qr_status(key) == result
        assert flow.qr_url == ""
        client.check_password.side_effect = errors.PasswordHashInvalid()
        with pytest.raises(HTTPException) as exc:
            await manager.check_2fa(Check2FA(flow_id=key, password="wrong"))
        assert exc.value.status_code == 400
        assert flow.state == "2FA_REQUIRED"
        client.check_password.side_effect = None
        flow.attempts = 7
        assert (await manager.check_2fa(Check2FA(flow_id=key, password="correct")))[
            "status"
        ] == "AUTHORIZED"
        assert (await manager.qr_status(key))["status"] == "AUTHORIZED"
    else:
        assert result["status"] == "AUTHORIZED"
    saved.assert_awaited_once()
    await manager.cancel(key)


async def test_floodwait_preserves_update_for_retry(qr_client):
    client, _, _ = qr_client
    manager, key, flow, _ = await begin(qr_client)
    flow.qr_event.set()
    client.invoke.side_effect = errors.FloodWait(30)
    with pytest.raises(HTTPException) as exc:
        await manager.qr_status(key)
    assert exc.value.status_code == 429
    assert exc.value.headers["Retry-After"] == "30"
    assert flow.qr_event.is_set()
    client.invoke.side_effect = None
    client.invoke.return_value = authorized()
    assert (await manager.qr_status(key))["status"] == "AUTHORIZED"
    await manager.cancel(key)


async def test_failed_start_releases_client_and_dispatcher(qr_client):
    client, _, saved = qr_client
    manager = AuthManager()
    client.invoke.side_effect = errors.ApiIdInvalid()
    with pytest.raises(HTTPException) as exc:
        await manager.start_qr(AuthParameters())
    assert exc.value.status_code == 400
    assert not manager.flows
    client.disconnect.assert_awaited_once()
    client.dispatcher.stop.assert_awaited_once()
    saved.assert_not_awaited()


async def test_qr_rejects_wrong_flow_and_early_password(qr_client):
    manager, key, flow, _ = await begin(qr_client)
    with pytest.raises(HTTPException) as exc:
        await manager.check_2fa(Check2FA(flow_id=key, password="too-early"))
    assert exc.value.status_code == 409
    with pytest.raises(HTTPException) as exc:
        await manager.sign_in(SignIn(flow_id=key, code="12345", phone_code_hash=""))
    assert exc.value.status_code == 409
    manager.flows["phone"] = AuthFlow(
        client=flow.client, spec=SendCode(phone="+8613800000000"), state="2FA_REQUIRED"
    )
    with pytest.raises(HTTPException) as exc:
        await manager.qr_status("phone")
    assert exc.value.status_code == 409
    await manager.cancel(key)


async def test_start_limit_is_shared_with_phone_and_rate_limited(qr_client):
    client, factory, _ = qr_client
    manager = AuthManager()
    for i in range(20):
        manager.flows[str(i)] = AuthFlow(client=client, spec=SendCode(phone="+8613800000000"))
    with pytest.raises(HTTPException) as exc:
        await manager.start_qr(AuthParameters())
    assert exc.value.status_code == 429
    factory.assert_not_called()
    manager.flows.clear()
    attempts.clear()
    for _ in range(10):
        result = await manager.start_qr(AuthParameters())
        await manager.cancel(result["flow_id"])
    with pytest.raises(HTTPException) as exc:
        await manager.start_qr(AuthParameters())
    assert exc.value.status_code == 429


async def test_qr_persistence_encrypts_session_without_phone_input(admin, account):
    with Session() as db:
        user_id = int(db.get(Account, account).user_id)
    client = SimpleNamespace(
        get_me=AsyncMock(
            return_value=SimpleNamespace(
                id=user_id,
                is_bot=False,
                first_name="Scanned",
                phone_number=None,
                username="scanned",
                photo=None,
            )
        ),
        export_session_string=AsyncMock(return_value="new-qr-session"),
    )
    spec = AuthParameters(api_id=1234, api_hash="a" * 32)
    assert await persist_account(client, spec) == account
    with Session() as db:
        saved = db.get(Account, account)
        assert saved.phone == ""
        assert saved.name == "Scanned"
        assert saved.session != "new-qr-session"
        assert decrypt(saved.session) == "new-qr-session"


def test_qr_api_requires_admin_and_csrf(client):
    client.cookies.clear()
    assert client.post("/api/auth/qr", json={}).status_code == 401
    assert client.post("/api/auth/qr/nonexistent").status_code == 401


def test_qr_api_validation_no_cache_and_account_reconnect(admin, monkeypatch):
    start = AsyncMock(return_value={"status": "QR_WAITING", "flow_id": "test-flow"})
    status = AsyncMock(return_value={"status": "AUTHORIZED", "account_id": 42})
    reconnect = AsyncMock()
    monkeypatch.setattr("backend.app.main.auth.start_qr", start)
    monkeypatch.setattr("backend.app.main.auth.qr_status", status)
    monkeypatch.setattr("backend.app.main.reconnect_account", reconnect)
    assert admin.post("/api/auth/qr", json={"api_id": 1234}).status_code == 422
    assert admin.post("/api/auth/qr", json={"proxy": "ftp://bad"}).status_code == 422
    assert (
        admin.post("/api/auth/qr", json={}, headers={"Origin": "https://evil.test"}).status_code
        == 403
    )
    assert (
        admin.post("/api/auth/qr/test-flow", headers={"Origin": "https://evil.test"}).status_code
        == 403
    )
    result = admin.post("/api/auth/qr", json={})
    assert result.status_code == 200
    assert result.headers["cache-control"] == "no-store"
    start.assert_awaited_once()
    result = admin.post("/api/auth/qr/test-flow")
    assert result.status_code == 200
    reconnect.assert_awaited_once_with(42, connect=False)
