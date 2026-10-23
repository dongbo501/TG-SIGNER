"""Share one live client per account with tg-signer's rate-limited API wrappers."""

import asyncio
import random
from collections import defaultdict
from contextlib import suppress

from fastapi import HTTPException
from pyrogram import errors
from pyrogram.session import Session as MTProtoSession
from sqlalchemy import select
from tg_signer import core
from tg_signer.ai_tools import AITools

from .auth import disconnect
from .db import DATA, Account, Session, get_setting, now
from .events import bus
from .notifications import notify
from .security import decrypt


class HeadlessClient(core.Client):
    async def connect(self):
        if self.is_connected:
            raise ConnectionError("Client is already connected")
        await self.load_session()
        await self._connect_transport()
        self.is_connected = True
        if self.ipv6 != (":" in await self.storage.server_address()):
            await self.set_dc(dc_id=await self.storage.dc_id())
        return bool(await self.storage.user_id())

    async def _connect_transport(self):
        # Keep a reference even when startup is cancelled or times out. Kurigram's
        # get_session assigns only after start, which can leave a partial session
        # inaccessible to the manager's cleanup on an initial connection failure.
        self.session = MTProtoSession(
            self,
            dc_id=await self.storage.dc_id(),
            server_address=await self.storage.server_address(),
            port=await self.storage.port(),
            auth_key=await self.storage.auth_key(),
            test_mode=await self.storage.test_mode(),
        )
        await self.session.start()
        await self.session.is_started.wait()

    async def start(self):
        if not self.is_connected:
            authorized = await self.connect()
            if not authorized:
                await self.disconnect()
                raise errors.AuthKeyUnregistered()
        self.me = await self.get_me()
        if not self.is_initialized:
            await self.initialize()
        return self

    async def reconnect(self):
        """Replace only the transport; workers and their handlers keep this client."""
        if not self.is_connected:
            return await self.start()
        if self.session is not None:
            await self.session.stop()
        # Kurigram's stopped sessions must be replaced, not started again.
        await self._connect_transport()
        return await self.start()

    async def save_session_string(self):
        # Session material is persisted encrypted by the dashboard only.
        return None


class AIMixin:
    def ensure_ai_cfg(self):
        if not decrypt(get_setting("ai_key")):
            raise ValueError("请先在系统设置中配置 AI API Key")

    def get_ai_tools(self):
        self.ensure_ai_cfg()
        return AITools(
            {
                "api_key": decrypt(get_setting("ai_key")),
                "base_url": get_setting("ai_base_url") or None,
                "model": get_setting("ai_model", "gpt-4o"),
            }
        )


class Signer(AIMixin, core.UserSigner):
    def load_config(self, cfg_cls=None):
        return self.config

    def log(self, msg, level="INFO", **kwargs):
        if level.upper() in {"WARNING", "ERROR", "CRITICAL"}:
            self.warnings.append(str(msg))
        super().log(msg, level, **kwargs)

    async def request_callback_answer(self, client, chat_id, message_id, callback_data, **kwargs):
        result = await self._call_telegram_api(
            "messages.GetBotCallbackAnswer",
            lambda: client.request_callback_answer(
                chat_id, message_id, callback_data=callback_data, **kwargs
            ),
        )
        if getattr(result, "text", None) and hasattr(self, "on_callback_text"):
            self.on_callback_text(str(result.text))
        self.log("点击完成")
        return result


class TelegramManager:
    CHECK_INTERVAL = 30
    CONNECT_TIMEOUT = 45
    RETRY_BASE = 5
    RETRY_MAX = 300

    def __init__(self):
        self.clients = {}
        self.locks = defaultdict(asyncio.Lock)
        self.execution_locks = defaultdict(asyncio.Lock)
        self.checks = {}
        self.failures = defaultdict(int)
        self.next_check = {}
        self.needs_reconnect = set()
        self.check_slots = asyncio.Semaphore(2)
        self.supervisor = None
        self.stopping = False

    def start(self):
        self.stopping = False
        if self.supervisor is None or self.supervisor.done():
            self.supervisor = asyncio.create_task(self._supervise(), name="telegram-connections")

    async def _supervise(self):
        while not self.stopping:
            try:
                await self.check_connections()
            except Exception as exc:
                bus.emit(f"连接巡检失败：{type(exc).__name__}", "WARNING")
            await asyncio.sleep(self.RETRY_BASE)

    async def check_connections(self):
        if self.stopping:
            return
        with Session() as db:
            ids = set(
                db.scalars(select(Account.id).where(Account.status.notin_(["invalid", "banned"])))
            )
        for account_id in set(self.clients) | set(self.checks):
            if account_id not in ids:
                await self.close(account_id)
        current = asyncio.get_running_loop().time()
        for account_id in ids:
            if account_id in self.checks or current < self.next_check.get(account_id, 0):
                continue
            future = asyncio.create_task(self._check(account_id), name=f"telegram-{account_id}")
            self.checks[account_id] = future

    async def _check(self, account_id):
        try:
            async with self.check_slots:
                await self.ping(account_id, quiet=True)
        except Exception as exc:
            # ping/mark_error set the retry deadline and classify terminal errors.
            bus.emit(f"连接检查失败：{type(exc).__name__}", "WARNING", account_id=account_id)
            if self.next_check.get(account_id, 0) <= asyncio.get_running_loop().time():
                self.next_check[account_id] = asyncio.get_running_loop().time() + self.RETRY_MAX
        finally:
            if self.checks.get(account_id) is asyncio.current_task():
                self.checks.pop(account_id, None)

    @staticmethod
    def ready(client):
        return (
            client.is_connected
            and client.is_initialized
            and client.session is not None
            and client.session.is_started.is_set()
            and client.me is not None
        )

    async def client(self, account_id):
        async with self.locks[account_id]:
            return await self._client(account_id)

    async def _client(self, account_id):
        if self.stopping:
            raise HTTPException(503, "服务正在关闭")
        with Session() as db:
            account = db.get(Account, account_id)
            if not account:
                raise HTTPException(404, "账号不存在")
            if account.status in {"invalid", "banned"}:
                raise HTTPException(409, "会话失效或账号被封禁，请重新登录")
        client = self.clients.get(account_id)
        remaining = self.next_check.get(account_id, 0) - asyncio.get_running_loop().time()
        if self.failures[account_id] and remaining > 0:
            raise HTTPException(
                503,
                "账号正在等待自动重连",
                headers={
                    "Retry-After": str(max(1, int(remaining) + 1)),
                },
            )
        if client and self.ready(client) and account_id not in self.needs_reconnect:
            return client
        existing = client is not None
        if client is None:
            proxy = decrypt(account.proxy) or decrypt(get_setting("global_proxy"))
            client = HeadlessClient(
                f"account-{account.id}",
                api_id=account.api_id,
                api_hash=decrypt(account.api_hash),
                session_string=decrypt(account.session),
                in_memory=True,
                workdir=DATA,
                proxy=core.get_proxy(proxy),
                workers=8,
            )
        try:
            async with asyncio.timeout(self.CONNECT_TIMEOUT):
                if existing:
                    await client.reconnect()
                else:
                    # Upstream __aenter__ swallows ConnectionError; start directly
                    # and retain one reference only after successful authorization.
                    await client.start()
                if not self.ready(client):
                    raise ConnectionError("Telegram transport is not ready")
        except BaseException as exc:
            if not existing:
                await self._dispose(client)
            elif client.session is not None:
                # Stop the library's own reconnect loop during our backoff, but
                # keep the dispatcher and registered listeners alive.
                try:
                    async with asyncio.timeout(10):
                        await client.session.stop()
                except (OSError, TimeoutError):
                    pass
            if isinstance(exc, Exception):
                await self.mark_error(account_id, exc)
            raise
        core._CLIENT_INSTANCES[client.key] = client
        if not existing:
            core._CLIENT_REFS[client.key] = 1
        self.clients[account_id] = client
        self.needs_reconnect.discard(account_id)
        return client

    def retry_delay(self, failures):
        delay = min(self.RETRY_MAX, self.RETRY_BASE * 2 ** min(failures - 1, 6))
        return min(self.RETRY_MAX, delay + random.uniform(0, delay * 0.2))

    async def mark_error(self, account_id, exc):
        banned = type(exc).__name__ in {
            "UserDeactivatedBan",
            "PhoneNumberBanned",
            "UserDeactivated",
        }
        invalid = isinstance(exc, errors.Unauthorized) or type(exc).__name__ == "AuthKeyDuplicated"
        transient = isinstance(exc, (OSError, TimeoutError, errors.InternalServerError))
        flood = isinstance(exc, errors.FloodWait)
        if not banned and not invalid and not transient and not flood:
            return
        if transient or flood:
            # Several callers may observe the same outage; keep its existing
            # deadline instead of increasing the delay for each observer.
            current = asyncio.get_running_loop().time()
            if current >= self.next_check.get(account_id, 0) or not self.failures[account_id]:
                self.failures[account_id] += 1
                delay = self.retry_delay(self.failures[account_id])
                if flood:
                    delay = max(delay, exc.value)
                self.next_check[account_id] = current + delay
                bus.emit(
                    f"账号连接异常，将在 {int(delay) + 1} 秒后自动重试",
                    "WARNING",
                    account_id=account_id,
                )
            if transient:
                self.needs_reconnect.add(account_id)
            if flood:
                self.next_check[account_id] = max(
                    self.next_check.get(account_id, 0), current + exc.value
                )
                return
        status = "banned" if banned else "invalid" if invalid else "offline"
        with Session() as db:
            a = db.get(Account, account_id)
            if a:
                changed = a.status != status
                a.status, a.last_checked = status, now()
                name = a.name
                db.commit()
                if changed and (banned or invalid):
                    await notify("Telegram 会话失效", f"账号 {name} 需要重新验证。")

    async def close(self, account_id):
        future = self.checks.pop(account_id, None)
        if future and future is not asyncio.current_task():
            future.cancel()
            await asyncio.gather(future, return_exceptions=True)
        async with self.locks[account_id]:
            client = self.clients.pop(account_id, None)
            if client:
                await self._dispose(client)
            self.failures.pop(account_id, None)
            self.next_check.pop(account_id, None)
            self.needs_reconnect.discard(account_id)

    async def _dispose(self, client):
        try:
            async with asyncio.timeout(10):
                await disconnect(client)
                # A cancelled connect may have a session before is_connected is set.
                if client.session is not None:
                    await client.session.stop()
                await client.storage.close()
        except Exception:
            bus.emit("清理 Telegram 连接超时或失败", "WARNING")
        finally:
            core._CLIENT_INSTANCES.pop(client.key, None)
            core._CLIENT_REFS.pop(client.key, None)
            core._LOGIN_USERS.pop(client.key, None)

    async def stop(self):
        self.stopping = True
        if self.supervisor:
            self.supervisor.cancel()
            with suppress(asyncio.CancelledError):
                await self.supervisor
            self.supervisor = None
        pending = list(self.checks.values())
        for future in pending:
            future.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
        self.checks.clear()

    async def shutdown(self):
        await self.stop()
        await asyncio.gather(*(self.close(i) for i in list(self.clients)))

    async def worker(self, account_id, cls=Signer, task_id="tools"):
        client = await self.client(account_id)
        worker = cls(
            task_name=str(task_id),
            account=client.name,
            session_dir=str(DATA),
            workdir=str(DATA / "upstream"),
            session_string=client.session_string,
            in_memory=True,
            loop=asyncio.get_running_loop(),
        )
        worker.user = client.me
        worker.warnings = []
        return worker

    async def ping(self, account_id, quiet=False):
        async with self.locks[account_id]:
            return await self._ping(account_id, quiet)

    async def _ping(self, account_id, quiet):
        try:
            client = await self._client(account_id)
            async with asyncio.timeout(self.CONNECT_TIMEOUT):
                me = await client.get_me()
                value = await client.export_session_string()
            from .security import encrypt

            with Session() as db:
                a = db.get(Account, account_id)
                if not a:
                    raise HTTPException(404, "账号不存在")
                recovering = a.status == "offline" or bool(self.failures[account_id])
                a.status, a.last_checked = "online", now()
                a.username, a.phone, a.session = (
                    me.username or "",
                    "+" + (me.phone_number or "").lstrip("+"),
                    encrypt(value),
                )
                db.commit()
            client.me = me
            self.failures.pop(account_id, None)
            self.needs_reconnect.discard(account_id)
            self.next_check[account_id] = asyncio.get_running_loop().time() + self.CHECK_INTERVAL
            if recovering:
                bus.emit("账号已自动恢复连接", account_id=account_id)
            elif not quiet:
                bus.emit("账号连接验证成功", account_id=account_id)
            return {"status": "online", "user_id": me.id}
        except Exception as exc:
            await self.mark_error(account_id, exc)
            raise


telegram = TelegramManager()
