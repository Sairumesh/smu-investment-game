from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import settings


class Base(DeclarativeBase):
    pass


def _build_engine(url: str):
    connect_args = {}
    if url.startswith("sqlite"):
        connect_args["check_same_thread"] = False
    return create_engine(url, future=True, connect_args=connect_args, pool_pre_ping=True, pool_recycle=1800,)


def get_engine(testing: bool = False):
    if testing and settings.test_database_url:
        return _build_engine(settings.test_database_url)
    return _build_engine(settings.database_url)


engine = get_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False, future=True)


@contextmanager
def db_session() -> Iterator[sessionmaker]:
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_db() -> Iterator[sessionmaker]:
    with db_session() as session:
        yield session
