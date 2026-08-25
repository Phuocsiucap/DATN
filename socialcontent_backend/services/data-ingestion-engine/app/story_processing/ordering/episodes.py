from sqlalchemy.orm import object_session

from common.db.models import ContentItem, Story


def update_story_completion(story: Story) -> None:
    session = object_session(story)
    if not session:
        story.total_episodes = 0
        story.completion_status = "UNKNOWN"
        return

    items = session.query(ContentItem).filter(ContentItem.story_id == story.id).all()
    numbers = sorted({item.episode_order for item in items if item.episode_order})
    if not numbers:
        story.total_episodes = 0
        story.completion_status = "UNKNOWN"
        return
    missing = [number for number in range(1, max(numbers) + 1) if number not in numbers]
    story.total_episodes = len(numbers)
    story.completion_status = "COMPLETE" if not missing else "MISSING_EPISODES"


def missing_episode_numbers(items: list[ContentItem]) -> list[int]:
    numbers = sorted({item.episode_order for item in items if item.episode_order})
    if not numbers:
        return []
    return [number for number in range(1, max(numbers) + 1) if number not in numbers]
