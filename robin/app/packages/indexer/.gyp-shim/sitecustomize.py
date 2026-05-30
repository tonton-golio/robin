"""
Fixes node-gyp CLT detection on macOS 26 (Darwin 25) where pkgutil receipts are missing.
Monkeypatches subprocess.check_output to return a fake CLT receipt for pkgutil queries.
"""
import subprocess as _subprocess
import sys as _sys

_original_check_output = _subprocess.check_output
_original_popen = _subprocess.Popen

FAKE_CLT_VERSION = "17.0.0.0.1.1700000000"
FAKE_RECEIPT = f"""package-id: com.apple.pkg.CLTools_Executables
version: {FAKE_CLT_VERSION}
volume: /
location: /
install-time: 1700000000
"""

PKG_IDS = {
    "com.apple.pkg.CLTools_Executables",
    "com.apple.pkg.DeveloperToolsCLILeo",
    "com.apple.pkg.DeveloperToolsCLI",
}

class FakePopen:
    """Mimics subprocess.Popen with fake CLT receipt output."""
    def __init__(self, args, **kwargs):
        self._is_fake = False
        self._fake_output = b""
        if isinstance(args, (list, tuple)):
            if len(args) >= 3 and args[0] == "/usr/sbin/pkgutil" and args[1] == "--pkg-info":
                pkg_id = args[2] if len(args) > 2 else ""
                if pkg_id in PKG_IDS:
                    self._is_fake = True
                    self._fake_output = FAKE_RECEIPT.encode()
        if not self._is_fake:
            kwargs.setdefault('stdout', None)
            self._real = _original_popen(args, **kwargs)

    @property
    def returncode(self):
        if self._is_fake:
            return 0
        return self._real.returncode

    def communicate(self, input=None, timeout=None):
        if self._is_fake:
            return (self._fake_output, b"")
        return self._real.communicate(input, timeout)

    def wait(self, timeout=None):
        if self._is_fake:
            return 0
        return self._real.wait(timeout)

    def __getattr__(self, name):
        if not self._is_fake:
            return getattr(self._real, name)
        raise AttributeError(name)

_subprocess.Popen = FakePopen
