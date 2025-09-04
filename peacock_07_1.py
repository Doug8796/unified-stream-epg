import time
import datetime
import xml.etree.ElementTree as ET
import re
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

# -----------------------------
# Configuration
# -----------------------------
PEACOCK_URL = "https://www.peacocktv.com/watch/sports/live-and-upcoming"
EPG_FILE = "peacock_epg.xml"
EVENT_FILE = "peacock_events.txt"
EVENT_DURATION_HOURS = 4.5
END_HOUR = 4  # EPG ends at 4 AM next day
MAX_CHANNELS = 7
MAX_DAYS_AHEAD = 7

# Persistent Chrome profile path
CHROME_PROFILE = r"C:\Users\Doug8\AppData\Local\Google\Chrome\User Data\PeacockProfile"

# -----------------------------
# Setup Chrome with persistent profile
# -----------------------------
options = Options()
options.add_argument(f"user-data-dir={CHROME_PROFILE}")
# Uncomment and set if your profile uses a specific folder, e.g., "Profile 1"
# options.add_argument(r'--profile-directory=Default')
options.add_argument("--disable-gpu")
options.add_argument("--no-sandbox")
options.add_argument("--disable-dev-shm-usage")
# options.add_argument("--headless=new")  # optional, may cause login issues

driver = webdriver.Chrome(options=options)
driver.get(PEACOCK_URL)

# -----------------------------
# Wait for page to load
# -----------------------------
wait = WebDriverWait(driver, 20)
driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
time.sleep(2)

# Grab all event cards
try:
    cards = wait.until(
        EC.presence_of_all_elements_located(
            (By.CSS_SELECTOR, "div[data-testid='metadata-container']")
        )
    )
    print(f"Found {len(cards)} event cards on the page.")
except Exception as e:
    print(f"Error finding event cards: {e}")
    cards = []

# -----------------------------
# Parse events
# -----------------------------
events = []
months = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December"
]

for card in cards:
    html = card.get_attribute("innerHTML")
    try:
        # Category
        sport_match = re.search(r'<span[^>]*class="[^"]*UhaIOWe7cS[^"]*"[^>]*>(.*?)</span>', html)
        sport = sport_match.group(1).strip() if sport_match else "Sports"

        # Title
        title_match = re.search(r'<h4[^>]*class="[^"]*QG1uxEKQ4X[^"]*"[^>]*>(.*?)</h4>', html)
        title_text = title_match.group(1).strip() if title_match else "N/A"

        # Times
        times = re.findall(r'<li[^>]*class="a7rB6G4p8N"[^>]*><span[^>]*>(.*?)</span></li>', html)
        date_str = times[0].strip() if len(times) > 0 else "N/A"
        time_str = times[1].strip() if len(times) > 1 else "N/A"

        # Parse date
        event_date = None
        if date_str.lower() == "today":
            event_date = datetime.date.today()
        elif date_str.lower() == "tomorrow":
            event_date = datetime.date.today() + datetime.timedelta(days=1)
        else:
            for month in months:
                if month in date_str:
                    try:
                        dt = datetime.datetime.strptime(date_str, "%B %d")
                        event_date = dt.replace(year=datetime.datetime.now().year).date()
                        break
                    except:
                        continue
        if not event_date:
            event_date = datetime.date.today()

        # Parse time
        event_time = datetime.datetime.now().time()
        if ":" in time_str and ("am" in time_str.lower() or "pm" in time_str.lower()):
            try:
                event_time = datetime.datetime.strptime(time_str, "%I:%M %p").time()
            except:
                pass

        # Combine date and time
        start_dt = datetime.datetime.combine(event_date, event_time).replace(second=0, microsecond=0)
        end_dt = (start_dt + datetime.timedelta(hours=EVENT_DURATION_HOURS)).replace(second=0, microsecond=0)

        # Truncate already started events to now
        now = datetime.datetime.now().replace(second=0, microsecond=0)
        if start_dt < now:
            start_dt = now

        # Filter events too far in future
        if start_dt > now + datetime.timedelta(days=MAX_DAYS_AHEAD):
            continue

        full_title = f"{sport} - {title_text}"
        events.append({"title": full_title, "start": start_dt, "end": end_dt})

    except:
        continue

driver.quit()

# -----------------------------
# Build XMLTV structure
# -----------------------------
tv = ET.Element("tv")
channels = []

def add_channel(index):
    channel_id = f"peacocksports{index}"
    ch_elem = ET.SubElement(tv, "channel", id=channel_id)
    ET.SubElement(ch_elem, "display-name").text = f"Peacock Sports {index}"
    channels.append({"id": channel_id, "schedule": []})
    return channels[-1]

for idx in range(1, MAX_CHANNELS + 1):
    add_channel(idx)

# Place events avoiding overlap
for event in sorted(events, key=lambda x: x["start"]):
    placed = False
    for ch in channels:
        if not ch["schedule"] or all(
            e["end"] <= event["start"] or e["start"] >= event["end"]
            for e in ch["schedule"]
        ):
            ch["schedule"].append(event)
            placed = True
            break
    if not placed:
        print(f"Skipped event (no free channel slot): {event['title']} at {event['start']}")

# -----------------------------
# Generate XML programmes and TXT output
# -----------------------------
with open(EVENT_FILE, "w", encoding="utf-8") as txt_file:
    event_counter = 1
    for ch_idx, ch in enumerate(channels, start=1):
        time_pointer = datetime.datetime.now().replace(second=0, microsecond=0)
        end_of_day = time_pointer.replace(hour=END_HOUR, minute=0) + datetime.timedelta(days=1)
        for prog in sorted(ch["schedule"], key=lambda x: x["start"]):
            # Fill gap with "Signed Off" in XML only
            if prog["start"] > time_pointer:
                signed_off = ET.SubElement(tv, "programme", {
                    "start": time_pointer.strftime("%Y%m%d%H%M%S"),
                    "stop": prog["start"].strftime("%Y%m%d%H%M%S"),
                    "channel": ch["id"]
                })
                ET.SubElement(signed_off, "title", lang="en").text = "Signed Off"

            # Add programme to XML
            programme = ET.SubElement(tv, "programme", {
                "start": prog["start"].strftime("%Y%m%d%H%M%S"),
                "stop": prog["end"].strftime("%Y%m%d%H%M%S"),
                "channel": ch["id"]
            })
            ET.SubElement(programme, "title", lang="en").text = prog["title"]

            # Write to TXT: event number, title, channel, times
            txt_file.write(f"Event {event_counter}: {prog['title']} (Channel {ch_idx})\n")
            txt_file.write(f"{prog['start'].strftime('%Y-%m-%d %H:%M')} - {prog['end'].strftime('%Y-%m-%d %H:%M')}\n\n")
            event_counter += 1

            time_pointer = prog["end"]

        # Fill remaining gap to end of day
        if time_pointer < end_of_day:
            signed_off = ET.SubElement(tv, "programme", {
                "start": time_pointer.strftime("%Y%m%d%H%M%S"),
                "stop": end_of_day.strftime("%Y%m%d%H%M%S"),
                "channel": ch["id"]
            })
            ET.SubElement(signed_off, "title", lang="en").text = "Signed Off"

# Save XML
tree = ET.ElementTree(tv)
with open(EPG_FILE, "wb") as f:
    tree.write(f, encoding="utf-8", xml_declaration=True)

print(f"✅ Created {EPG_FILE} and {EVENT_FILE} with {len(events)} events.")
