import feedparser

url = "https://vnexpress.net/rss/tin-moi-nhat.rss"
feed = feedparser.parse(url)

for entry in feed.entries:
    print({
        "title": entry.title,
        "link": entry.link,
        "published": entry.published
    })