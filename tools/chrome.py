"""Drive the installed Google Chrome headlessly over the DevTools protocol.

Used by tools/people/bake.py to render the people's stills with the app's own 3D stage, and
handy for screenshots of the interface:

    from chrome import chrome
    with chrome() as browser:
        page = browser.open("http://127.0.0.1:5173/")
        page.wait("document.readyState === 'complete'")
        page.screenshot("home.png")

Needs Google Chrome in /Applications and the `websockets` package (installed with the engine).
"""

from __future__ import annotations

import base64
import json
import subprocess
import tempfile
import time
import urllib.request
from contextlib import contextmanager
from pathlib import Path

from websockets.sync.client import connect

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


class Page:
    def __init__(self, ws_url: str):
        self.ws = connect(ws_url, max_size=256 * 1024 * 1024)
        self.counter = 0
        self.send("Page.enable")
        self.send("Runtime.enable")

    def send(self, method: str, **params) -> dict:
        self.counter += 1
        ident = self.counter
        self.ws.send(json.dumps({"id": ident, "method": method, "params": params}))
        while True:
            message = json.loads(self.ws.recv())
            if message.get("id") == ident:
                if "error" in message:
                    raise RuntimeError(f"{method}: {message['error']}")
                return message.get("result", {})

    def eval(self, expression: str, timeout: float = 60):
        result = self.send(
            "Runtime.evaluate", expression=expression, returnByValue=True, awaitPromise=True, timeout=int(timeout * 1000)
        )
        if "exceptionDetails" in result:
            raise RuntimeError(result["exceptionDetails"].get("text", "evaluation failed"))
        return result.get("result", {}).get("value")

    def wait(self, condition: str, timeout: float = 120, every: float = 0.25):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.eval(f"Boolean({condition})"):
                return
            time.sleep(every)
        raise TimeoutError(condition)

    def size(self, width: int, height: int, scale: float = 1):
        self.send("Emulation.setDeviceMetricsOverride", width=width, height=height, deviceScaleFactor=scale, mobile=False)

    def goto(self, url: str):
        self.send("Page.navigate", url=url)

    def screenshot(self, path: str | Path, full: bool = False):
        params = {"format": "png"}
        if full:
            metrics = self.send("Page.getLayoutMetrics")
            size = metrics["cssContentSize"]
            params["clip"] = {"x": 0, "y": 0, "width": size["width"], "height": size["height"], "scale": 1}
            params["captureBeyondViewport"] = True
        data = self.send("Page.captureScreenshot", **params)["data"]
        Path(path).write_bytes(base64.b64decode(data))

    def close(self):
        self.ws.close()


class Browser:
    def __init__(self, port: int):
        self.port = port

    def open(self, url: str, width: int = 1440, height: int = 960) -> Page:
        request = urllib.request.Request(f"http://127.0.0.1:{self.port}/json/new?about:blank", method="PUT")
        target = json.loads(urllib.request.urlopen(request).read())
        page = Page(target["webSocketDebuggerUrl"])
        page.size(width, height)
        page.goto(url)
        return page


@contextmanager
def chrome(port: int = 9333):
    profile = tempfile.mkdtemp(prefix="reticulate-chrome-")
    process = subprocess.Popen(
        [
            CHROME,
            "--headless=new",
            f"--remote-debugging-port={port}",
            f"--user-data-dir={profile}",
            "--ignore-gpu-blocklist",
            "--enable-unsafe-swiftshader",
            "--no-first-run",
            "--no-default-browser-check",
            "--hide-scrollbars",
            "about:blank",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=1)
                break
            except OSError:
                time.sleep(0.1)
        yield Browser(port)
    finally:
        process.terminate()
        process.wait(timeout=10)
