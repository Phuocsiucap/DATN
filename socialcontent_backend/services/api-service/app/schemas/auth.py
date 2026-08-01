from pydantic import BaseModel, Field


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class RegisterRequest(BaseModel):
    email: str
    password: str = Field(min_length=8)
    full_name: str | None = None


class LoginRequest(BaseModel):
    email: str
    password: str


class BootstrapAdminRequest(BaseModel):
    bootstrap_token: str
    email: str
    password: str = Field(min_length=10)
    full_name: str | None = "System Admin"
