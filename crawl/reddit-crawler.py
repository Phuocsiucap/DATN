import praw

reddit = praw.Reddit(
    client_id="YOUR_ID",
    client_secret="YOUR_SECRET",
    user_agent="crawler"
)

subreddit = reddit.subreddit("news")

for post in subreddit.hot(limit=10):
    print({
        "title": post.title,
        "score": post.score,
        "url": post.url
    })