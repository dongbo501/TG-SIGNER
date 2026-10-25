import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from pyrogram import errors
from tg_signer import core

from backend.app.db import Account, Session
from backend.app.telegram import HeadlessClient, TelegramManager


class FakeClient:
    def __init__(self, name="account-test", **kwargs):
        self.name = name
        self.key = name
        self.session_string = "test-session"
        self.is_connected = False
        self.is_initialized = False
        self.me = None
        self.handlers = [object()]
        self.session = SimpleNamespace(is_started=asyncio.Event(), stop=AsyncMock())
        self.storage = SimpleNamespace(close=AsyncMock())
        self.get_me = AsyncMock(
            return_value=SimpleNamespace(
                id=987654321,
                username="test",
                phone_number="8613800000000",
            )
        )
        self.export_session_string = AsyncMock(return_value="refreshed-session")
        self.start = AsyncMock(side_effect=self._start)
        self.reconnect = AsyncMock(side_effect=self._start)
        self.terminate = AsyncMock(side_effect=self._terminate)
        self.disconnect = AsyncMock(side_effect=self._disconnect)

    async def _start(self):
        self.is_connected = self.is_initialized = True
        self.session.is_started.set()
        self.me = await self.get_me()
        return self

    async def _terminate(self):
        self.is_initialized = False

    async def _disconnect(self):
        self.is_connected = False
        self.session.is_started.clear()


@pytest.fixture
async def manager(client, account):
    instance = TelegramManager()
    yield instance
    await instance.shutdown()


@pytest.fixture
def fake(monkeypatch):
    instance = FakeClient()
    monkeypatch.setattr("backend.app.telegram.HeadlessClient", lambda *a, **kw: instance)
    return instance


def status(account_id):
    with Session() as db:
        return db.get(Account, account_id).status


async def run_check(manager, account_id):
    await manager.check_connections()
    if account_id in manager.checks:
        await manager.checks[account_id]


async def test_initial_connection_failure_is_not_cached_or_online(manager, account, fake):
    fake.start.side_effect = ConnectionError("network down")
    with pytest.raises(ConnectionError):
        await manager.client(account)
    assert account not in manager.clients
    assert fake.key not in core._CLIENT_INSTANCES
    assert fake.key not in core._CLIENT_REFS
    assert status(account) == "offline"
    fake.storage.close.assert_awaited()
    assert manager.next_check[account] > asyncio.get_running_loop().time()


async def test_disconnected_cached_client_recovers_once_for_concurrent_callers(
    manager,
    account,
    fake,
):
    await manager.ping(account)
    fake.session.is_started.clear()  # is_connected can stay True after a broken socket.
    original_handlers = fake.handlers
    results = await asyncio.gather(*(manager.client(account) for _ in range(8)))
    assert all(result is fake for result in results)
    fake.reconnect.assert_awaited_once()
    assert fake.handlers is original_handlers
    assert core._CLIENT_REFS[fake.key] == 1


async def test_background_startup_and_outage_recovery(manager, account, fake):
    await run_check(manager, account)
    assert status(account) == "online"
    fake.get_me.side_effect = TimeoutError()
    manager.next_check[account] = 0
    await run_check(manager, account)
    assert status(account) == "offline"
    assert account in manager.needs_reconnect
    assert account not in manager.checks
    await manager.check_connections()
    assert not manager.checks, "backoff must prevent immediate retries"
    fake.get_me.side_effect = None
    manager.next_check[account] = 0
    await run_check(manager, account)
    assert status(account) == "online"
    assert not manager.failures.get(account)
    assert account not in manager.needs_reconnect
    fake.reconnect.assert_awaited_once()
    with Session() as db:
        from backend.app.security import decrypt

        assert decrypt(db.get(Account, account).session) == "refreshed-session"


async def test_healthy_account_is_checked_every_five_minutes(manager, account, fake):
    before = asyncio.get_running_loop().time()
    await run_check(manager, account)
    after = asyncio.get_running_loop().time()
    assert before + 300 <= manager.next_check[account] <= after + 300
    calls = fake.get_me.await_count
    await run_check(manager, account)
    assert fake.get_me.await_count == calls
    manager.next_check[account] = 0
    await run_check(manager, account)
    assert fake.get_me.await_count == calls + 1


@pytest.mark.parametrize("cached", [False, True])
async def test_three_failed_retries_stop_background_and_task_connections(
    manager, account, fake, cached
):
    if cached:
        await manager.ping(account)
        fake.get_me.side_effect = TimeoutError()
        manager.next_check[account] = 0
    else:
        fake.start.side_effect = ConnectionError("network down")
    await run_check(manager, account)
    assert manager.retries.get(account, 0) == 0
    fake.reconnect.side_effect = ConnectionError("network down")
    for attempt in range(1, 4):
        manager.next_check[account] = 0
        await run_check(manager, account)
        assert manager.retries[account] == attempt
        assert (account in manager.paused) is (attempt == 3)
    assert status(account) == "offline"
    for _ in range(5):
        manager.next_check[account] = 0  # Even an elapsed deadline cannot restart retries.
        await run_check(manager, account)
        assert not manager.checks
    for request in (manager.client, manager.ping):
        with pytest.raises(HTTPException) as exc:
            await request(account)
        assert exc.value.status_code == 503
        assert "手动刷新" in exc.value.detail
    assert fake.reconnect.await_count == (3 if cached else 0)
    assert fake.start.await_count == (1 if cached else 4)


async def test_third_retry_can_succeed_and_reset_budget(manager, account, fake):
    await manager.ping(account)
    await manager.mark_error(account, TimeoutError())
    fake.reconnect.side_effect = ConnectionError()
    for _ in range(2):
        manager.next_check[account] = 0
        await run_check(manager, account)
    fake.reconnect.side_effect = fake._start
    manager.next_check[account] = 0
    await run_check(manager, account)
    assert fake.reconnect.await_count == 3
    assert status(account) == "online"
    assert account not in manager.paused
    assert account not in manager.retries
    await manager.mark_error(account, TimeoutError())
    fake.reconnect.side_effect = ConnectionError()
    manager.next_check[account] = 0
    await run_check(manager, account)
    assert manager.retries[account] == 1
    assert account not in manager.paused


async def test_manual_refresh_resumes_after_retry_limit(manager, account, fake, monkeypatch):
    from backend.app.main import reconnect_account

    monkeypatch.setattr("backend.app.main.telegram", manager)
    fake.start.side_effect = ConnectionError()
    for _ in range(4):
        manager.next_check[account] = 0
        await run_check(manager, account)
    assert account in manager.paused
    fake.start.side_effect = fake._start
    assert (await reconnect_account(account))["status"] == "online"
    assert account not in manager.paused
    assert account not in manager.retries
    assert not manager.failures.get(account)


async def test_final_verification_failure_stops_library_reconnect_loop(manager, account, fake):
    await manager.ping(account)
    await manager.mark_error(account, TimeoutError())
    fake.reconnect.side_effect = ConnectionError()
    for _ in range(2):
        manager.next_check[account] = 0
        await run_check(manager, account)
    fake.reconnect.side_effect = None
    fake.reconnect.return_value = fake
    fake.session.stop.reset_mock()
    fake.get_me.side_effect = TimeoutError()
    manager.next_check[account] = 0
    await run_check(manager, account)
    assert manager.retries[account] == 3
    assert account in manager.paused
    fake.session.stop.assert_awaited_once()
    fake.terminate.assert_not_awaited()


async def test_flood_wait_on_healthy_connection_does_not_consume_retries(manager, account, fake):
    await manager.ping(account)
    fake.get_me.side_effect = errors.FloodWait(600)
    for _ in range(5):
        manager.next_check[account] = 0
        before = asyncio.get_running_loop().time()
        await run_check(manager, account)
        assert manager.next_check[account] >= before + 600
    assert account not in manager.paused
    assert not manager.retries.get(account)
    fake.reconnect.assert_not_awaited()


async def test_flood_wait_during_reconnect_still_obeys_retry_limit(manager, account, fake):
    await manager.ping(account)
    await manager.mark_error(account, TimeoutError())
    fake.reconnect.side_effect = errors.FloodWait(600)
    for attempt in range(1, 4):
        manager.next_check[account] = 0
        await run_check(manager, account)
        assert manager.retries[account] == attempt
        await manager.check_connections()
        assert not manager.checks
    assert account in manager.paused
    fake.reconnect.assert_awaited()
    assert fake.reconnect.await_count == 3


async def test_deadline_applies_to_manual_requests_and_duplicate_errors(manager, account, fake):
    fake.start.side_effect = OSError("offline")
    await run_check(manager, account)
    deadline = manager.next_check[account]
    await manager.mark_error(account, TimeoutError())
    assert manager.next_check[account] == deadline
    assert manager.failures[account] == 1
    with pytest.raises(HTTPException) as exc:
        await manager.client(account)
    assert exc.value.status_code == 503
    fake.start.assert_awaited_once()


def test_backoff_grows_and_is_capped():
    manager = TelegramManager()
    assert 5 <= manager.retry_delay(1) <= 6
    assert 10 <= manager.retry_delay(2) <= 12
    assert 20 <= manager.retry_delay(3) <= 24
    assert manager.retry_delay(10000) == 300


@pytest.mark.parametrize(
    "error,expected",
    [
        (errors.AuthKeyUnregistered(), "invalid"),
        (errors.SessionRevoked(), "invalid"),
        (errors.AuthKeyDuplicated(), "invalid"),
        (errors.UserDeactivatedBan(), "banned"),
        (errors.PhoneNumberBanned(), "banned"),
    ],
)
async def test_terminal_errors_stop_retries(manager, account, fake, monkeypatch, error, expected):
    notify = AsyncMock()
    monkeypatch.setattr("backend.app.telegram.notify", notify)
    await manager.ping(account)
    fake.get_me.side_effect = error
    manager.next_check[account] = 0
    await run_check(manager, account)
    assert status(account) == expected
    await manager.check_connections()
    assert account not in manager.clients
    assert account not in manager.checks
    with pytest.raises(HTTPException) as exc:
        await manager.client(account)
    assert exc.value.status_code == 409
    notify.assert_awaited_once()


async def test_flood_wait_is_respected_without_resetting_transport(manager, account, fake):
    await manager.ping(account)
    fake.get_me.side_effect = errors.FloodWait(600)
    manager.next_check[account] = 0
    before = asyncio.get_running_loop().time()
    await run_check(manager, account)
    assert manager.next_check[account] >= before + 600
    assert status(account) == "online"
    assert account not in manager.needs_reconnect
    await manager.check_connections()
    assert not manager.checks
    fake.reconnect.assert_not_awaited()


async def test_flood_wait_extends_an_existing_network_backoff(manager, account, fake):
    await manager.ping(account)
    await manager.mark_error(account, TimeoutError())
    before = asyncio.get_running_loop().time()
    await manager.mark_error(account, errors.FloodWait(600))
    assert manager.next_check[account] >= before + 600
    with pytest.raises(HTTPException) as exc:
        await manager.client(account)
    assert exc.value.status_code == 503


async def test_unresponsive_connection_attempt_times_out(manager, account, fake):
    async def pending():
        await asyncio.Event().wait()

    manager.CONNECT_TIMEOUT = 0.01
    fake.start.side_effect = pending
    with pytest.raises(TimeoutError):
        await manager.client(account)
    assert status(account) == "offline"
    assert manager.failures[account] == 1
    assert account not in manager.clients
    fake.storage.close.assert_awaited_once()


async def test_failed_reconnect_keeps_existing_worker_client(manager, account, fake):
    await manager.ping(account)
    fake.session.is_started.clear()
    fake.reconnect.side_effect = ConnectionError()
    with pytest.raises(ConnectionError):
        await manager.client(account)
    assert manager.clients[account] is fake
    assert core._CLIENT_INSTANCES[fake.key] is fake
    fake.terminate.assert_not_awaited()
    fake.session.stop.assert_awaited_once()
    manager.next_check[account] = 0
    fake.reconnect.side_effect = fake._start
    assert await manager.client(account) is fake


async def test_cancelled_initial_connect_does_not_mark_account_invalid(manager, account, fake):
    entered = asyncio.Event()

    async def pending():
        entered.set()
        await asyncio.Event().wait()

    fake.start.side_effect = pending
    future = asyncio.create_task(manager.client(account))
    await entered.wait()
    future.cancel()
    with pytest.raises(asyncio.CancelledError):
        await future
    assert not manager.clients
    assert not manager.failures.get(account)
    fake.storage.close.assert_awaited_once()


async def test_shutdown_cancels_checks_and_cannot_reconnect(manager, account, fake):
    entered = asyncio.Event()

    async def pending():
        entered.set()
        await asyncio.Event().wait()

    await manager.ping(account)
    fake.get_me.side_effect = pending
    manager.next_check[account] = 0
    manager.start()
    await entered.wait()
    await manager.shutdown()
    assert manager.supervisor is None
    assert not manager.checks
    assert not manager.clients
    assert fake.key not in core._CLIENT_INSTANCES
    await manager.check_connections()
    assert not manager.checks
    with pytest.raises(HTTPException) as exc:
        await manager.client(account)
    assert exc.value.status_code == 503


async def test_deleted_account_is_not_recreated(manager, account, fake):
    await manager.ping(account)
    with Session() as db:
        db.delete(db.get(Account, account))
        db.commit()
    await manager.check_connections()
    assert account not in manager.clients
    assert not manager.checks


async def test_headless_reconnect_replaces_transport_and_preserves_dispatcher(monkeypatch):
    client = HeadlessClient("test-transport", api_id=1234, api_hash="a" * 32, in_memory=True)
    client.is_connected = client.is_initialized = True
    client.storage = SimpleNamespace(
        **{
            name: AsyncMock(return_value=value)
            for name, value in {
                "dc_id": 2,
                "server_address": "127.0.0.1",
                "port": 443,
                "auth_key": b"test",
                "test_mode": False,
            }.items()
        }
    )
    old_session = SimpleNamespace(stop=AsyncMock())
    client.session = old_session
    new_session = SimpleNamespace(is_started=asyncio.Event(), start=AsyncMock())
    new_session.is_started.set()
    monkeypatch.setattr("backend.app.telegram.MTProtoSession", lambda *a, **kw: new_session)
    client.start = AsyncMock(return_value=client)
    dispatcher = client.dispatcher
    handler = object()
    dispatcher.groups[1001] = [handler]
    assert await client.reconnect() is client
    assert client.session is new_session
    assert client.dispatcher is dispatcher
    assert dispatcher.groups[1001] == [handler]
    old_session.stop.assert_awaited_once()
    new_session.start.assert_awaited_once()
    client.start.assert_awaited_once()


async def test_partial_transport_is_available_for_cleanup_on_startup_cancellation(monkeypatch):
    client = HeadlessClient("test-partial", api_id=1234, api_hash="a" * 32, in_memory=True)
    client.storage = SimpleNamespace(
        **{
            name: AsyncMock(return_value=value)
            for name, value in {
                "dc_id": 2,
                "server_address": "127.0.0.1",
                "port": 443,
                "auth_key": b"test",
                "test_mode": False,
                "user_id": 987654321,
            }.items()
        }
    )
    client.load_session = AsyncMock()
    entered = asyncio.Event()

    async def pending():
        entered.set()
        await asyncio.Event().wait()

    session = SimpleNamespace(start=AsyncMock(side_effect=pending))
    monkeypatch.setattr("backend.app.telegram.MTProtoSession", lambda *a, **kw: session)
    future = asyncio.create_task(client.connect())
    await entered.wait()
    future.cancel()
    with pytest.raises(asyncio.CancelledError):
        await future
    assert client.session is session
    assert not client.is_connected
