import time 
import json
import random
from faker import Faker
from kafka import KafkaProducer

fake = Faker()

hashtags = ['#fun', '#life', '#travel', '#food', '#fashion', '#music', '#sports', '#art', '#technology', '#nature']

producer = KafkaProducer(
    bootstrap_servers='localhost:9092',
    value_serializer=lambda v: json.dumps(v).encode('utf-8')
)
trend_mode = False

while True:
    if random.random() < 0.1:
        hashtag = "AI"  # ép AI trending
    else:
        hashtag = random.choice(hashtags)
        
    data = {
        "platform": "twitter",
        "user": fake.user_name(),
        "text": fake.sentence() + f" #{hashtag}",
        "hashtags": [hashtag],
        "timestamp": int(time.time())
    }

    producer.send("twitter-posts", value=data)
    print("Sent data:", data)

    time.sleep(random.uniform(0.5, 2))