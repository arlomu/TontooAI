## Intergrations

```Defaults
German Train
Fetcher
```
---

**How to make your own**:

```Copy ME
name: Deutsche Bahn # The name of the integration; it will also be displayed in the integrations menu
description: Trains & timetables in Germany # A short description of the integration; only relevant here, not shown anywhere else
author: "arlomu, Claude" # The authors; also not shown anywhere
tags: [transport, germany, trains, public-transport] # The tags help categorize the integration but are not shown in any GUI
license: MIT # Also not shown in the GUI
repository: https://github.com/arlomu/Bahn-API-Integration # Also not shown in the GUI
version: 1.0.0 # Also not shown in the GUI
icon: icon.png # The icon will be displayed in the integrations menu, small and in front of the name

systemprompt: |
  You are a Deutsche Bahn assistant. Respond **only** in pure JSON, **without Markdown, code blocks, or additional explanations**.
  Example output:
  {
    "from": "Berlin%20Hbf",
    "to": "Hamburg%20Hbf",
    "departure": "2024-07-02T15:30:00"
  }


api-call1-go-to-ai: false # Whether the API output is returned to the AI or not
api-call1: curl "https://v6.db.transport.rest/locations?query=%ai_from%&results=1" # The API URL that is called; %ai_from% is replaced with the value returned by the AI
api-call1-output: | # The output of the API that is returned to the AI
  [
      {
          "id": "1",
          "name": "2",
          "type": "3",
          "location": {
              "type": "location",
              "id": "4",
              "latitude": 5,
              "longitude": 6
          },
          "products": {
              "nationalExpress": 7,
              "national": 8,
              "regionalExpress": 9,
              "regional": 10,
              "suburban": 11,
              "bus": 12,
              "ferry": 13,
              "subway": 14,
              "tram": 15,
              "taxi": 16
          },
          "weight": 17,
          "ril100Ids": [
              "18",
              "19",
              "20",
              "21"
          ],
          "ifoptId": "22",
          "priceCategory": 23,
          "transitAuthority": "24",
          "stadaId": "25"
      }
  ]

api-call2-go-to-ai: false
api-call2: curl "https://v6.db.transport.rest/locations?query=%ai_to%&results=1" # The API URL that is called; %ai_to% is replaced with the value returned by the AI
api-call2-output: |
  [
      {
          "id": "1",
          "name": "2",
          "type": "3",
          "location": {
              "type": "location",
              "id": "4",
              "latitude": 5,
              "longitude": 6
          },
          "products": {
              "nationalExpress": 7,
              "national": 8,
              "regionalExpress": 9,
              "regional": 10,
              "suburban": 11,
              "bus": 12,
              "ferry": 13,
              "subway": 14,
              "tram": 15,
              "taxi": 16
          },
          "weight": 17,
          "ril100Ids": [
              "18",
              "19",
              "20",
              "21"
          ],
          "ifoptId": "22",
          "priceCategory": 23,
          "transitAuthority": "24",
          "stadaId": "25"
      }
  ]

api-call3-go-to-ai: true # Whether the API output is returned to the AI or not
api-call3: |
  curl -s "https://v6.db.transport.rest/stops/8011160/departures?duration=60" \
  | jq '[.departures[0:3] | .[] | {line: .line.name, when: .when, delay: .delay, platform: .platform, direction: .direction}]'
  # now the connections are being queried
api-call3-output: |
  [
    {
      "line": "ICE 804",
      "when": "2025-09-21T11:15:00+02:00",
      "delay": 2280,
      "platform": "8",
      "direction": "Hamburg-Altona"
    },
    {
      "line": "S 3",
      "when": "2025-09-21T11:11:00+02:00",
      "delay": 1320,
      "platform": "16",
      "direction": "Berlin-Spandau (S)"
    },
    {
      "line": "ICE 650",
      "when": "2025-09-21T11:12:00+02:00",
      "delay": 1200,
      "platform": "13",
      "direction": "Cologne Central Station"
    }
  ]

# Max 5 API calls!
```

**Steps**

# Step 1

Create a Folder

# Step 2

Create a info.yml and paste the code in it

# Step 3

Edit this file and set The APIs and more

# Step 4

Create a PNG picture and set the name in the info.yml and Move the Picture to the Folder

# Step 5

(Not Needed) Create a README.md and Explain the Intergration

# Step 6

Move the Folder in the /intergrations/ folder and Restart you TontooAI

# Step 7

Try & Use it :)