# MandiPulse: simple user guide

## Open the website

Public website: **https://mandipulse-rosy.vercel.app/**. You can open this address on another computer or phone.

On this computer, open http://127.0.0.1:5175/. If it is not running, open PowerShell in this project folder and enter `.\start.cmd -OpenBrowser` once. You do not need to start two servers manually. The startup and installation details are in README.md.

## Ask a question

Type in the large question box and press Send. For example:

- List tomato prices from lowest to highest.
- Give me prices for dals.
- Show whole pulses instead.
- Make a buying plan for 50 kg of moong dal, budget Rs 6000, deliver to Bengaluru, freight Rs 100 per quintal.
- Give me the same plan for tomato.
- How should I store dal in my shop? Give simple steps.

The assistant can use earlier messages in the current chat. Use New chat when you want to start a separate topic.

## What the controls do

| Control | What it does |
| --- | --- |
| Chat Mode | Opens the assistant. |
| Overview / map icon | Shows available price records and their dates. |
| Search crops or markets | Searches the market overview. |
| Make a buying plan / + | Opens a form for crop, weight, budget, destination and your freight estimate. |
| English / Kannada | Chooses the answer language. |
| Simple answer / Compare & explain | Chooses a short answer or more detail. Requested price comparisons still use tables. |
| Voice | Dictates a question when your browser supports it and you allow microphone access. |
| Read aloud | Reads an answer using an available browser voice. |
| Send / Stop | Sends a question or stops waiting for an answer. |
| Refresh / clock icon | Requests the latest available records. |
| Bell | Creates a price alert in this browser. Alerts are checked only while the page is open and visible with live data; notifications need your permission. |
| Saved plans / bookmark icon | Opens saved account items, or offers sign-in. |
| Profile / G | Opens optional sign-in or account controls. |
| Back / Forward | Moves between views you opened inside the app. |

## Read a plan or table

Weights can be entered in kilograms, quintals or metric tonnes. One quintal is 100 kg; one metric tonne is 1,000 kg. Crop prices are wholesale observations, not shop retail prices.

Mixed plans put crop, suggested weight and estimated cost first. Scroll sideways for other columns and down for more rows. Whole pulses and processed dal are different products; check the Form column, variety and price date.

An equal stock split is a trial mix, not a prediction of what customers will buy. Freight is included only at the rate you enter. Confirm actual delivery charges, current stock and quality before purchasing.

## Understand the price status

- **Official feed:** read each observation's date; a retrieval time does not make an old price today's price.
- **Dated official records · not live:** the primary feed is unavailable, has no usable Karnataka rows, or lacks the product you requested. The app is using recent official weekly reports or a validated saved official snapshot. Coverage is partial and cannot establish the cheapest market across the whole state. An individual answer may use dated reports while Overview shows other live prices. Asking specifically for today never substitutes an older report.
- **No Karnataka prices available:** no usable official records were returned. You can still ask general guidance questions and try prices later.

The full official crop catalog can contain more products than the current price table. Choosing a catalog product asks the app to check its price; it does not promise that a report is available for every crop or market.

## Download or save

For a plan, choose Yes, download PDF, or Not now. You can download later from its plan card. Ordinary questions do not create PDFs automatically.

Questions, comparisons and PDF downloads work without an account. Sign in only if you want cloud saving. A guest chat is not restored after a reload, so download a plan you want to keep before closing the page.

The public Vercel address works on other devices. The 127.0.0.1 address works only on the computer running the local servers.
