# Laptop Shop Management System (POS & Repair) - Instructions

## 1. Business Requirements Overview
This system is designed for a laptop business handling Wholesale, Retail, and Repair services.

### A. Inventory Management
* **Product Catalog:** Ability to add/edit laptops, parts, and accessories.
* **Serial Number Tracking:** Each laptop must have a unique Serial Number/IMEI for warranty tracking.
* **Dual Pricing:** Maintain separate prices for **Wholesale** and **Retail**.
* **Stock Alerts:** Notification when stock levels for specific items (e.g., RAM, SSDs) are low.

### B. Sales & Invoicing
* **Customer Profiles:** Save customer name, phone number, and address.
* **Invoicing:** Generate digital receipts for both Wholesale and Retail sales.
* **Discounts:** Option to apply flat or percentage-based discounts.
* **Warranty Management:** Automatically calculate warranty expiry dates based on the sale date.

### C. Repair Module (Job Cards)
* **Job Entry:** Record incoming repair items with Serial Numbers, issue descriptions, and estimated costs.
* **Status Tracking:** Update status: `Pending` -> `In-Progress` -> `Fixed` -> `Delivered` -> `Returned`.
* **Repair Billing:** Add parts used from inventory and labor charges to the final repair invoice.

### D. Reporting
* Daily/Monthly sales summaries.
* Profit/Loss calculation based on wholesale vs. retail margins.
* Pending repair list.

---

## 2. Technical Requirements (The Tech Stack)

* **Frontend:** HTML5, Tailwind CSS (for modern, responsive styling).
* **Logic:** Vanilla JavaScript (ES6+).
* **Database:** **Dexie.js** (A wrapper for IndexedDB) to store all data locally in the browser.
* **Offline Capability:** The system should work without an active internet connection.
* **Printing:** Integration with the Browser Print API to print A4 or thermal receipts.

---

## 3. Database Schema (Dexie.js Structure)

The database should be initialized with the following stores:

| Store Name | Primary Key | Indexes |
| :--- | :--- | :--- |
| `products` | `++id` | `name, serialNo, category, type (retail/wholesale)` |
| `customers` | `++id` | `name, phone` |
| `sales` | `++id` | `customerID, date, totalAmount` |
| `repairs` | `++id` | `jobCardNo, customerName, status, deviceSerial` |

---

## 4. Development Instructions & Workflow

### Phase 1: Setup
1. Create an `index.html` and link Tailwind CSS via CDN.
2. Initialize a `database.js` file using Dexie.js.

### Phase 2: Inventory UI
1. Create a form to "Add New Product" including:
   - Name, Brand, Serial Number, Cost Price, Retail Price, Wholesale Price, Stock Quantity.
2. Create a "Inventory View" table with search functionality.

### Phase 3: Sales Logic
1. Create a "New Sale" screen.
2. Search product by Serial Number or Name.
3. Toggle between "Retail" and "Wholesale" prices.
4. On "Finalize Sale," reduce stock quantity and save to `sales` store.

### Phase 4: Repair Module
1. Create a "Job Card" form for incoming repairs.
2. Print a "Customer Receipt" upon receiving the device.
3. Add a "Repair Dashboard" to see all active jobs.

### Phase 5: Backup & Security
1. **JSON Export:** Since data is in the browser, add a button to "Export Database" as a `.json` file for daily backups.
2. **Local Hosting:** Suggest using a local server (like Live Server or a simple Node host) to run the app.

---

## 5. UI/UX Guidelines
* **Sidebar Navigation:** Dashboard, Inventory, Sales, Repairs, Reports, Settings.
* **Responsive Design:** Must work on the laptop screen (min 1366x768).
* **Color Palette:** Use professional colors (Slate-800 for sidebars, Blue-600 for primary actions).