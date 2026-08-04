import json
import os
import sys
import argparse
from datetime import datetime
from kafka import KafkaConsumer

# Add project root to sys.path
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

try:
    from common.events import topics
    KNOWN_TOPICS = [
        val for attr, val in vars(topics).items()
        if not attr.startswith("__") and isinstance(val, str)
    ]
except ImportError:
    KNOWN_TOPICS = []


def main():
    parser = argparse.ArgumentParser(description="Listen to ALL Kafka topics in real-time.")
    parser.add_argument(
        "--bootstrap-servers",
        default=os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092"),
        help="Kafka bootstrap servers (default: localhost:9092)"
    )
    parser.add_argument(
        "--from-beginning",
        action="store_true",
        help="Read all past messages from beginning instead of only new messages"
    )
    args = parser.parse_args()

    bootstrap_servers = args.bootstrap_servers.split(",")
    offset_reset = "earliest" if args.from_beginning else "latest"

    print("=" * 70)
    print(f" 🚀 KAFKA MONITOR / SNIFFER")
    print(f" 📍 Servers: {bootstrap_servers}")
    print(f" ⏳ Mode: {'FROM BEGINNING (Earliest)' if args.from_beginning else 'REAL-TIME ONLY (Latest)'}")
    print("=" * 70)

    try:
        # Create Kafka consumer subscribing to a regex pattern for all topics
        consumer = KafkaConsumer(
            bootstrap_servers=bootstrap_servers,
            auto_offset_reset=offset_reset,
            enable_auto_commit=False,
            group_id=f"kafka-sniffer-{int(datetime.now().timestamp())}",
            value_deserializer=lambda v: json.loads(v.decode('utf-8')) if v else None,
            key_deserializer=lambda k: k.decode('utf-8') if k else None
        )
        
        # Subscribe to all non-internal topics using regex pattern
        consumer.subscribe(pattern=r'^(?!__).*')
        
        print("Listening for incoming messages... (Press CTRL+C to stop)\n")
        
        for msg in consumer:
            now_str = datetime.now().strftime("%H:%M:%S.%f")[:-3]
            print(f"[{now_str}] 📩 TOPIC: \033[93m{msg.topic}\033[0m | Partition: {msg.partition} | Offset: {msg.offset}")
            if msg.key:
                print(f"   🔑 Key: {msg.key}")
            if msg.value:
                try:
                    payload_str = json.dumps(msg.value, indent=2, ensure_ascii=False)
                    # Indent lines for clear display
                    indented_payload = "\n".join(f"   {line}" for line in payload_str.split("\n"))
                    print(f"   📦 Value:\n{indented_payload}")
                except Exception:
                    print(f"   📦 Raw Value: {msg.value}")
            else:
                print("   📦 Value: None")
            print("-" * 70)

    except KeyboardInterrupt:
        print("\nStopped listening.")
    except Exception as e:
        print(f"\n❌ Error connecting to Kafka: {e}")


if __name__ == "__main__":
    main()
