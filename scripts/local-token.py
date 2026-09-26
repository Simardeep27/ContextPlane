#!/usr/bin/env python3
"""Local-only credential, transported through a private pipe or process environment."""
import argparse
import ctypes
import os
import re
import secrets
import sys

SERVICE = b"ContextPlane Local"
ACCOUNT = b"context-plane-local-api-token"


def validate(value):
    if not re.fullmatch(r"[A-Za-z0-9_-]{32,256}", value):
        raise RuntimeError("Local token must be 32-256 URL-safe characters.")
    return value


def keychain_token(create=False):
    if sys.platform != "darwin":
        raise RuntimeError("Set CONTEXT_PLANE_LOCAL_TOKEN through a hidden Terminal prompt or secret manager on this platform.")
    security = ctypes.CDLL("/System/Library/Frameworks/Security.framework/Security")
    pointer, size = ctypes.c_void_p, ctypes.c_uint32
    security.SecKeychainFindGenericPassword.argtypes = [pointer, size, ctypes.c_char_p,
        size, ctypes.c_char_p, ctypes.POINTER(size), ctypes.POINTER(pointer), ctypes.POINTER(pointer)]
    security.SecKeychainFindGenericPassword.restype = ctypes.c_int32
    security.SecKeychainItemFreeContent.argtypes = [pointer, pointer]
    security.SecKeychainItemFreeContent.restype = ctypes.c_int32
    security.SecKeychainAddGenericPassword.argtypes = [pointer, size, ctypes.c_char_p,
        size, ctypes.c_char_p, size, ctypes.c_char_p, ctypes.POINTER(pointer)]
    security.SecKeychainAddGenericPassword.restype = ctypes.c_int32

    def read():
        length, data = size(), pointer()
        status = security.SecKeychainFindGenericPassword(None, len(SERVICE), SERVICE,
            len(ACCOUNT), ACCOUNT, ctypes.byref(length), ctypes.byref(data), None)
        if status == -25300:
            return None
        if status != 0:
            raise RuntimeError(f"Keychain read failed ({status}); unlock the login Keychain and retry.")
        try:
            return validate(ctypes.string_at(data, length.value).decode("ascii"))
        finally:
            security.SecKeychainItemFreeContent(None, data)

    value = read()
    if value is not None:
        return value
    if not create:
        raise RuntimeError("Local token is not initialized. Run python3 scripts/local-token.py ensure.")
    value = secrets.token_urlsafe(32)
    encoded = value.encode("ascii")
    status = security.SecKeychainAddGenericPassword(None, len(SERVICE), SERVICE,
        len(ACCOUNT), ACCOUNT, len(encoded), encoded, None)
    if status == -25299:
        return read()
    if status != 0:
        raise RuntimeError(f"Keychain write failed ({status}); unlock the login Keychain and retry.")
    return value


def token(create=False):
    configured = os.environ.get("CONTEXT_PLANE_LOCAL_TOKEN")
    return validate(configured) if configured is not None else keychain_token(create)


def main():
    parser = argparse.ArgumentParser(description="Initialize the local MCP token without displaying it.")
    parser.add_argument("mode", choices=["ensure", "pipe"])
    parser.add_argument("--create", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.mode == "ensure":
        token(create=True)
        print("Local MCP token is ready; its value was not displayed.")
    else:
        if sys.stdout.isatty():
            raise RuntimeError("Credential output requires a private pipe; do not run pipe mode in a Terminal.")
        sys.stdout.write(token(create=args.create))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error, RuntimeError) else "Local credential helper failed.", file=sys.stderr)
        sys.exit(1)
