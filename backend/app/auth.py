"""Bounded, expiring Telegram authentication state machine; never calls start()."""

import asyncio
import base64
import math
import secrets
import time
from dataclasses import dataclass, field

from fastapi import HTTPException
from pyrogram import Client, errors, raw
from pyrogram.handlers import RawUpdateHandler
from sqlalchemy import select
from tg_signer.core import get_api_config, get_proxy

from .db import Account, Session, get_setting, now
from .schemas import AuthParameters
from .security import decrypt, encrypt, rate_limit


async def disconnect(client):
    try:
        if client.is_initialized:
            await client.terminate()
        if client.is_connected:
            await client.disconnect()
    except (ConnectionError, OSError):
        pass


def telegram_error(exc):
    if isinstance(exc, errors.FloodWait):
        return HTTPException(
            429,
            f"Telegram 要求等待 {exc.value} 秒",
            headers={"Retry-After": str(exc.value)},
        )
    mapping = {
        "PhoneCodeInvalid": "验证码错误",
        "PhoneCodeExpired": "验证码已过期，请重新发送",
        "PasswordHashInvalid": "二步验证密码错误",
        "PhoneNumberInvalid": "手机号格式错误",
        "PhoneNumberBanned": "此手机号已被 Telegram 封禁",
        "ApiIdInvalid": "API_ID 或 API_HASH 无效",
        "AuthKeyUnregistered": "Session 已失效，请重新登录",
        "SessionRevoked": "Session 已被撤销",
        "AuthTokenExpired": "二维码已过期，请重新开始扫码登录",
        "AuthTokenInvalid": "二维码已失效，请重新开始扫码登录",
        "AuthTokenAlreadyAccepted": "二维码已被使用，请重新开始扫码登录",
    }
    return HTTPException(
        400, mapping.get(type(exc).__name__, f"Telegram 请求失败：{type(exc).__name__}")
    )


async def persist_account(client, spec):
    me = await client.get_me()
    if me.is_bot:
        raise HTTPException(400, "请导入 Telegram 用户账号 Session")
    session_string = await client.export_session_string()
    avatar = ""
    if me.photo:
        try:
            async with asyncio.timeout(10):
                stream = await client.download_media(me.photo.small_file_id, in_memory=True)
                if stream:
                    avatar = (
                        "data:image/jpeg;base64," + base64.b64encode(stream.getvalue()).decode()
                    )
        except Exception:
            pass
    with Session() as db:
        account = db.scalar(select(Account).where(Account.user_id == str(me.id)))
        if not account:
            account = Account(user_id=str(me.id))
            db.add(account)
        account.name = spec.name or me.first_name or str(me.id)
        phone = me.phone_number or getattr(spec, "phone", "")
        account.phone = "+" + phone.lstrip("+") if phone else ""
        account.username = me.username or ""
        account.session = encrypt(session_string)
        account.api_id = spec.api_id
        account.api_hash = encrypt(spec.api_hash)
        account.proxy = encrypt(spec.proxy)
        account.avatar = avatar
        account.status = "online"
        account.last_checked = now()
        db.commit()
        return account.id


@dataclass
class AuthFlow:
    client: Client
    spec: AuthParameters
    state: str = "CODE_SENT"
    code_hash: str = ""
    created: float = field(default_factory=time.monotonic)
    sent: float = field(default_factory=time.monotonic)
    attempts: int = 0
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    qr_event: asyncio.Event | None = None
    qr_url: str = ""
    qr_deadline: float = 0
    account_id: int | None = None


class AuthManager:
    def __init__(self):
        self.flows: dict[str, AuthFlow] = {}
        self.send_lock = asyncio.Lock()

    async def cleanup(self):
        for key, flow in list(self.flows.items()):
            if time.monotonic() - flow.created > 600 and not flow.lock.locked():
                await self.cancel(key)

    async def cancel(self, key):
        flow = self.flows.get(key)
        if flow:
            async with flow.lock:
                self.flows.pop(key, None)
                await self.disconnect_flow(flow)

    @staticmethod
    async def disconnect_flow(flow):
        try:
            if flow.qr_event is not None:
                await flow.client.dispatcher.stop()
        finally:
            await disconnect(flow.client)

    def get(self, key, state):
        flow = self.flows.get(key)
        if not flow or time.monotonic() - flow.created > 600:
            raise HTTPException(410, "登录流程已过期，请重新开始")
        if flow.state not in ((state,) if isinstance(state, str) else state):
            raise HTTPException(409, "当前登录步骤不匹配")
        if flow.attempts >= 8 and flow.state != "AUTHORIZED":
            raise HTTPException(429, "验证次数过多，请重新开始")
        return flow

    async def send(self, spec):
        async with self.send_lock:
            await self.cleanup()
            rate_limit("tg:" + spec.phone, limit=5, window=600)
            if spec.flow_id:
                flow = self.get(spec.flow_id, "CODE_SENT")
                async with flow.lock:
                    self.get(spec.flow_id, "CODE_SENT")
                    if time.monotonic() - flow.sent < 60:
                        raise HTTPException(429, "请等待 60 秒再重发验证码")
                    try:
                        async with asyncio.timeout(45):
                            result = await flow.client.resend_code(flow.spec.phone, flow.code_hash)
                        flow.code_hash, flow.sent = (
                            result.phone_code_hash,
                            time.monotonic(),
                        )
                        return self.payload(spec.flow_id, flow)
                    except errors.RPCError as exc:
                        raise telegram_error(exc) from exc
            if sum(f.state != "AUTHORIZED" for f in self.flows.values()) >= 20:
                raise HTTPException(429, "待完成的登录流程过多")
            if not spec.api_id:
                spec.api_id, spec.api_hash = get_api_config()
            proxy = spec.proxy or decrypt(get_setting("global_proxy"))
            client = Client(
                "auth-" + secrets.token_hex(8),
                api_id=spec.api_id,
                api_hash=spec.api_hash,
                in_memory=True,
                proxy=get_proxy(proxy),
                no_updates=True,
            )
            try:
                async with asyncio.timeout(45):
                    await client.connect()
                    result = await client.send_code(spec.phone)
                flow = AuthFlow(client=client, spec=spec, code_hash=result.phone_code_hash)
                key = secrets.token_urlsafe(32)
                self.flows[key] = flow
                return self.payload(key, flow)
            except BaseException as exc:
                await disconnect(client)
                if isinstance(exc, errors.RPCError):
                    raise telegram_error(exc) from exc
                raise

    async def start_qr(self, spec):
        async with self.send_lock:
            await self.cleanup()
            rate_limit("tg:qr", limit=10, window=600)
            if sum(f.state != "AUTHORIZED" for f in self.flows.values()) >= 20:
                raise HTTPException(429, "待完成的登录流程过多")
            if not spec.api_id:
                spec.api_id, spec.api_hash = get_api_config()
            client = Client(
                "auth-qr-" + secrets.token_hex(8),
                api_id=spec.api_id,
                api_hash=spec.api_hash,
                in_memory=True,
                proxy=get_proxy(spec.proxy or decrypt(get_setting("global_proxy"))),
                no_updates=False,
                skip_updates=True,
                workers=1,
                sleep_threshold=0,
            )
            flow = AuthFlow(client=client, spec=spec, state="QR_WAITING", qr_event=asyncio.Event())

            async def on_update(client, update, users, chats):
                if isinstance(update, raw.types.UpdateLoginToken):
                    flow.qr_event.set()

            client.add_handler(RawUpdateHandler(on_update))
            try:
                async with asyncio.timeout(45):
                    await client.connect()
                    # Start only the update dispatcher: initialize/start require authorization.
                    await client.dispatcher.start()
                    await self.export_qr(flow)
                key = secrets.token_urlsafe(32)
                self.flows[key] = flow
                return self.qr_payload(key, flow)
            except BaseException as exc:
                await self.disconnect_flow(flow)
                if isinstance(exc, errors.RPCError):
                    raise telegram_error(exc) from exc
                raise

    async def export_qr(self, flow):
        # A browser poll normally reads memory. Export only on UpdateLoginToken or
        # expiry, so polling never rotates an otherwise usable QR or floods Telegram.
        flow.qr_event.clear()
        client = flow.client
        try:
            result = await client.invoke(
                raw.functions.auth.ExportLoginToken(
                    api_id=flow.spec.api_id, api_hash=flow.spec.api_hash, except_ids=[]
                )
            )
            if isinstance(result, raw.types.auth.LoginTokenMigrateTo):
                dc = await client.get_dc_option(result.dc_id, ipv6=client.ipv6)
                await client.session.stop()
                # QR migration needs a fresh DC auth key; set_dc alone reuses the old key.
                client.session = await client.get_session(
                    dc_id=result.dc_id,
                    server_address=dc.ip_address,
                    port=dc.port,
                    export_authorization=False,
                    temporary=True,
                )
                await client.storage.dc_id(result.dc_id)
                await client.storage.server_address(dc.ip_address)
                await client.storage.port(dc.port)
                await client.storage.auth_key(client.session.auth_key)
                result = await client.invoke(
                    raw.functions.auth.ImportLoginToken(token=result.token)
                )
            if isinstance(result, raw.types.auth.LoginTokenSuccess):
                await client.storage.user_id(result.authorization.user.id)
                await client.storage.is_bot(False)
                flow.state = "QR_READY"
                flow.qr_url = ""
            elif isinstance(result, raw.types.auth.LoginToken):
                token = base64.urlsafe_b64encode(result.token).decode().rstrip("=")
                flow.qr_url = "tg://login?token=" + token
                flow.qr_deadline = time.monotonic() + max(0, result.expires - client.server_time)
            else:
                raise HTTPException(502, "Telegram 返回了无法识别的扫码登录状态，请重新开始")
        except errors.SessionPasswordNeeded:
            flow.state = "2FA_REQUIRED"
            flow.qr_url = ""
        except BaseException:
            # A failed export must be retried even if it consumed the update event.
            flow.qr_event.set()
            raise

    @staticmethod
    def qr_payload(key, flow):
        result = {"flow_id": key, "status": flow.state}
        if flow.state == "QR_WAITING":
            result.update(
                qr_url=flow.qr_url,
                expires_in=max(0, math.ceil(flow.qr_deadline - time.monotonic())),
            )
        elif flow.state == "AUTHORIZED":
            result["account_id"] = flow.account_id
        return result

    async def qr_status(self, key):
        states = ("QR_WAITING", "QR_READY", "2FA_REQUIRED", "AUTHORIZED")
        flow = self.get(key, states)
        async with flow.lock:
            self.get(key, states)
            if flow.qr_event is None:
                raise HTTPException(409, "当前流程不是扫码登录")
            try:
                async with asyncio.timeout(45):
                    if flow.state == "QR_WAITING" and (
                        flow.qr_event.is_set() or time.monotonic() >= flow.qr_deadline
                    ):
                        await self.export_qr(flow)
                    if flow.state == "QR_READY":
                        return await self.finish(key, flow)
                    return self.qr_payload(key, flow)
            except errors.RPCError as exc:
                raise telegram_error(exc) from exc

    @staticmethod
    def payload(key, flow):
        return {
            "flow_id": key,
            "status": flow.state,
            "phone_code_hash": flow.code_hash,
            "resend_after": 60,
            "expires_in": max(0, int(600 - time.monotonic() + flow.created)),
        }

    async def finish(self, key, flow):
        account_id = await persist_account(flow.client, flow.spec)
        flow.state = "AUTHORIZED"
        flow.account_id = account_id
        flow.qr_url = ""
        # Keep QR completion until cancel/expiry so a lost poll response is retryable.
        if flow.qr_event is None:
            self.flows.pop(key, None)
        await self.disconnect_flow(flow)
        return {"status": "AUTHORIZED", "account_id": account_id}

    async def sign_in(self, data):
        flow = self.get(data.flow_id, "CODE_SENT")
        async with flow.lock:
            self.get(data.flow_id, "CODE_SENT")
            if not secrets.compare_digest(flow.code_hash, data.phone_code_hash):
                raise HTTPException(409, "验证码流程已更新，请使用最新验证码")
            flow.attempts += 1
            try:
                async with asyncio.timeout(45):
                    user = await flow.client.sign_in(flow.spec.phone, flow.code_hash, data.code)
                    if not hasattr(user, "id"):
                        raise HTTPException(400, "此手机号尚未注册，请先在 Telegram 客户端注册")
                    return await self.finish(data.flow_id, flow)
            except errors.SessionPasswordNeeded:
                flow.state = "2FA_REQUIRED"
                return {"status": "2FA_REQUIRED", "flow_id": data.flow_id}
            except errors.RPCError as exc:
                if isinstance(exc, errors.PhoneCodeExpired):
                    flow.created = 0
                raise telegram_error(exc) from exc

    async def check_2fa(self, data):
        flow = self.get(data.flow_id, "2FA_REQUIRED")
        async with flow.lock:
            self.get(data.flow_id, "2FA_REQUIRED")
            flow.attempts += 1
            try:
                async with asyncio.timeout(45):
                    await flow.client.check_password(data.password)
                    return await self.finish(data.flow_id, flow)
            except errors.RPCError as exc:
                raise telegram_error(exc) from exc


auth = AuthManager()
