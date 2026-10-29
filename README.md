# Smart Complaint Management System (SCMS)

## Admin Complaint Management

### Overview
The Admin Complaint Management feature allows administrators to manage and monitor complaints submitted through the Smart Complaint Management System.

### Features
- View complaints submitted by users.
- Access complaint details.
- Update complaint status.
- Manage complaints through the admin interface.
- Connect the frontend with backend APIs for complaint operations.

### Technology Stack
- **Frontend:** React.js
- **Backend:** Node.js and Express.js
- **Database:** Project-configured database
- **Version Control:** Git and GitHub

### Project Structure
- `frontend/` – Contains the user interface and admin complaint management components.
- `backend/` – Contains server-side logic and API routes.

### Getting Started

#### 1. Clone the Repository
```bash
git clone https://github.com/Smart-Complaint-Management-System/Smart-complaint-management-system.git
cd Smart-complaint-management-system
```

#### 2. Install Dependencies
Install the frontend and backend dependencies separately:

```bash
cd backend
npm install
```

```bash
cd ../frontend
npm install
```

#### 3. Run the Application
Start the backend and frontend in separate terminals using the start scripts configured in their respective `package.json` files.

Configure the required environment variables before starting the backend.

### Testing
Run the tests using the test scripts configured in the backend `package.json`. Verify complaint listing, complaint details, and status updates.

### Branch Information
- **Feature Branch:** `feature/admin-complaint-management`

### Purpose
This feature aims to provide administrators with a centralized interface to review complaints and manage their status efficiently.
