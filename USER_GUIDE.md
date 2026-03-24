# Election Dashboard: User Guide & Management Manual

## 1. Welcome to the Dashboard
This dashboard is a powerful tool designed to monitor national election results as they happen. It takes complex data from spreadsheets and turns it into an easy-to-understand map and set of charts. 

**Key Purpose:** To provide a single, clear view of "Who is winning," "Voter turnout," and "Gender representation" across the nation.

---

## 2. Using the Interactive Map
The map is the heart of the dashboard. Here is how you can use it:
*   **Move & Zoom:** Use your mouse to drag the map or the (+) and (-) buttons to zoom into specific states or districts.
*   **Hovering (The "Quick Look"):** Moving your mouse over a district will show a small box with the district's name and its current top stats.
*   **Clicking (The "Deep Dive"):** When you find a district you want to analyze, click on it. This will "lock" the dashboard to that district, updating all the charts on the right and showing the list of elected candidates.
*   **Color Views:** Use the dropdown menu in the top-right to change how the map is colored:
    *   **Turnout:** Shows where people are voting most (vibrant green).
    *   **Winner:** Colors each district based on which party is leading.
    *   **Margin of Victory:** Shows how "close" the race is in each area.

---

## 3. Reading the Analytics (Sidebars)
*   **The Left Sidebar (Parties):** This lists all political parties. Click on a party to see every district where they are currently leading.
*   **The Right Sidebar (Charts):**
    *   **Vote Share:** Shows the total slice of the "voter pie" each party has.
    *   **Seat Share:** Shows how many actual seats each party has won.
    *   **Gender Split:** A simple view of how many men and women have been elected.
    *   **Parliament Layout:** A visual representation of the council seats. Each dot is one seat, colored by the party.

---

## 4. How to Update Data (For Staff)
The dashboard is connected to a **Google Sheet**. To update the results, you only need to edit the spreadsheet—there is no need to touch any code.

### **Steps to update results:**
1.  Open the official Election Results Google Sheet.
2.  Navigate to the relevant tab (e.g., `party_results`).
3.  Update the `votes_received` or `seats_won` columns for each district.
4.  **Save/Close:** Google Sheets saves automatically.
5.  **View the Dashboard:** Refresh the web browser page. The dashboard will automatically fetch the newest numbers within seconds.

> [!IMPORTANT]
> **Data Rule:** Never change the names of the column headers (the top row). If you rename "dist_code" to "Area Code," the dashboard will not know where to look.

---

## 5. Frequently Asked Questions (FAQ)

**Q: Why is the dashboard showing "No data" for a district?**
**A:** This usually means the district code in the spreadsheet doesn't match the code on the map. Ensure the ID numbers in the `party_results` sheet are correct.

**Q: How do I save a report?**
**A:** Click the "Export Map" button at the top. You can choose a paper size (like A4 or A3) and it will generate a high-quality PDF of your current view.

**Q: Does the dashboard work on mobile?**
**A:** This specific version is optimized for high-resolution desktop and laptop screens (Full HD) to ensure all side-by-side charts are visible for monitoring staff.

---
*Created for the National Independent Electoral Commission.*
