"""Module with logging that includes actor attribution."""
import logging

logger = logging.getLogger(__name__)


def handle_request(user_id: str, action: str):
    logger.info(f"user_id={user_id} performing action={action}")
    logger.info(f"session_id={get_session()} completed")
