# File Transfer Application

A secure, resumable file transfer web application with authentication and real-time progress tracking.

![File Transfer](screenshot.png)

## Features

- **Secure Authentication**: User login with JWT token-based authentication
- **Resumable Uploads**: Continue interrupted uploads from where they left off
- **Chunked Transfers**: Files are transferred in 1MB chunks for reliability
- **Progress Tracking**: Real-time upload progress with speed and time estimates
- **Pause/Resume**: Control over active uploads
- **Automatic Retries**: Failed chunks are automatically retried (up to 3 times)
- **File Status**: Detailed metadata about each transfer
- **Responsive UI**: Works on desktop and mobile devices
- **Error Handling**: Clear error messages and recovery options

## Technologies Used

- **Frontend**:
  - React with TypeScript
  - Tailwind CSS for styling
  - Framer Motion for animations
  - React Icons (Feather icons)
  - Axios for HTTP requests

- **Backend**:
  - Expected to support resumable uploads via chunked transfer encoding
  - JWT authentication
  - File status tracking

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/stvishw/file-transfer.git
   cd file-transfer-app

## How to Start
Backend
command: - 

go run cmd/main.go

Frontend
Commad: -

npm run dev
## API Endpoints

API Endpoints

Authentication
Method	Endpoint	Description	Request	Response
POST	/login	Authenticate user	{ username: string, password: string }	{ access_token: string }
File Operations (Require Authentication)
Method	Endpoint	Description	Headers	Parameters	Request Body
POST	/init_upload	Initialize file upload	Authorization: Bearer <token>	file_id, total_size query params	None
POST	/upload_chunk	Upload file chunk	Authorization: Bearer <token>, Content-Range: bytes <start>-<end>/<total>	None	File chunk binary data


Public Endpoints
Method	Endpoint	Description	Headers	Parameters
GET	/status/:file_id	Check file upload status	None	file_id in URL path
GET	/download/:file_id	Download complete file	None	file_id in URL path


CORS Configuration
The API is configured with the following CORS policies:

Allowed Origin: http://localhost:3000

Allowed Methods: GET, POST, PUT, DELETE, OPTIONS

Allowed Headers: Content-Type, Authorization, Content-Range

Credentials: true

