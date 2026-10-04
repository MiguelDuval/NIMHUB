from pathlib import Path
import os
import tempfile

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    nvidia_api_key: str | None = None
    nvidia_base_url: str = "https://integrate.api.nvidia.com/v1"
    nim_hub_admin_token: str | None = None
    nim_hub_env_file: str = ".env"
    nim_hub_host: str = "127.0.0.1"
    nim_hub_port: int = 8787
    nim_hub_allowed_origin: str = "http://localhost:5173"
    nim_hub_allowed_origins: str = "http://localhost:5173,http://localhost,https://localhost"
    mcp_servers_json: str | None = None

    model_config = SettingsConfigDict(env_file=".env", env_prefix="", extra="ignore")


settings = Settings()


def normalize_nvidia_base_url(value: str) -> str:
    from urllib.parse import urlsplit, urlunsplit

    raw = value.strip()
    if not raw:
        raise ValueError("NVIDIA base URL is required")
    parsed = urlsplit(raw)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("NVIDIA base URL must be a valid http:// or https:// URL")
    if parsed.username or parsed.password:
        raise ValueError("NVIDIA base URL must not contain embedded credentials")
    if parsed.query or parsed.fragment:
        raise ValueError("NVIDIA base URL must not contain query or fragment")
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), "", ""))


def persist_nvidia_settings(api_key: str, base_url: str) -> None:
    path = Path(settings.nim_hub_env_file).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    existing = path.read_text(encoding="utf-8") if path.exists() else ""
    lines = existing.splitlines()
    replacements = {"NVIDIA_API_KEY": api_key, "NVIDIA_BASE_URL": base_url}
    seen: set[str] = set()
    output: list[str] = []

    for line in lines:
        stripped = line.strip()
        replaced = False
        for key, value in replacements.items():
            if stripped.startswith(f"{key}="):
                output.append(f"{key}={value}")
                seen.add(key)
                replaced = True
                break
        if not replaced:
            output.append(line)

    for key, value in replacements.items():
        if key not in seen:
            output.append(f"{key}={value}")

    content = "\n".join(output) + "\n"
    fd, temp_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=str(path.parent),
        text=True,
    )
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(content)
        os.replace(temp_name, path)
        os.chmod(path, 0o600)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)
