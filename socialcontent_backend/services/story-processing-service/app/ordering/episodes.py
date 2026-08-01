from common.db.models import Episode, Story


def update_story_completion(story: Story) -> None:
    real_episodes = [episode for episode in story.episodes if not episode.is_missing and episode.episode_number]
    numbers = sorted({episode.episode_number for episode in real_episodes if episode.episode_number})
    if not numbers:
        story.total_episodes = 0
        story.completion_status = "UNKNOWN"
        return
    missing = [number for number in range(1, max(numbers) + 1) if number not in numbers]
    story.total_episodes = len(numbers)
    story.completion_status = "COMPLETE" if not missing else "MISSING_EPISODES"


def missing_episode_numbers(episodes: list[Episode]) -> list[int]:
    numbers = sorted({episode.episode_number for episode in episodes if episode.episode_number and not episode.is_missing})
    if not numbers:
        return []
    return [number for number in range(1, max(numbers) + 1) if number not in numbers]
