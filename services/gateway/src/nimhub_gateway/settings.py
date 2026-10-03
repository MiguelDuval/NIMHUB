from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    nvidia_api_key: str | None = None
    nvidia_base_url: str = "https://integrate.api.nvidia.com/v1"
    nim_hub_host: str = "127.0.0.1"
    nim_hub_port: int = 8787
    nim_hub_allowed_origin: str = "http://localhost:5173"

    model_config = SettingsConfigDict(env_file='.env', env_prefix='', extra='ignore')


settings = Settings()
