# AWS CloudFront Google SSO

A Terraform project that sets up a secure CloudFront distribution with Google SSO authentication using Lambda@Edge.

## Architecture

This project creates:

- **S3 Bucket**: Hosts static content (protected by CloudFront)
- **CloudFront Distribution**: CDN with Lambda@Edge authentication
- **Lambda@Edge Function**: Handles Google SSO authentication flow
- **Origin Access Control**: Secure S3 access from CloudFront only

## Features

- Google Sign-In integration using Google Identity Services
- JWT token verification with Google's public certificates
- Secure cookie-based session management
- CSRF protection
- Lambda@Edge for global authentication

## Prerequisites

- AWS CLI configured with appropriate permissions
- Terraform installed
- Google Cloud Console project with OAuth 2.0 credentials
- Node.js and npm (for Lambda function build)

## Setup

### 1. Configure Google OAuth 2.0

- Go to [Google Cloud Console](https://console.cloud.google.com/)
- Create or select a project
- Create OAuth 2.0 credentials
- Add your CloudFront domain to authorized redirect URIs

### 2. Set Google Client ID

```bash
export TF_VAR_google_client_id="your-google-client-id.apps.googleusercontent.com"
```

### 3. Deploy Infrastructure

```bash
terraform init
terraform plan
terraform apply
```

## 4. Cleanup

```bash
terraform destroy
```

## Authentication Flow

```mermaid
sequenceDiagram
    participant User
    participant CloudFront
    participant Lambda@Edge
    participant Google
    participant S3

    User->>CloudFront: 1. Request protected resource
    CloudFront->>Lambda@Edge: 2. viewer-request trigger
    Lambda@Edge->>Lambda@Edge: 3. Check authentication cookie

    alt No valid cookie
        Lambda@Edge->>User: 4. Return Google Sign-In page
        User->>Google: 5. Click Sign-In with Google
        Google->>User: 6. Return JWT credential + CSRF token
        User->>CloudFront: 7. POST /callback with credential
        CloudFront->>Lambda@Edge: 8. viewer-request trigger
        Lambda@Edge->>Lambda@Edge: 9. Validate CSRF token
        Lambda@Edge->>Google: 10. Fetch public certificates
        Google->>Lambda@Edge: 11. Return PEM certificates
        Lambda@Edge->>Lambda@Edge: 12. Verify JWT signature
        Lambda@Edge->>User: 13. Set secure cookie + redirect to /
        User->>CloudFront: 14. Request / with cookie
        CloudFront->>Lambda@Edge: 15. viewer-request trigger
    end

    Lambda@Edge->>Lambda@Edge: 16. Validate existing cookie
    Lambda@Edge->>CloudFront: 17. Forward request to origin
    CloudFront->>S3: 18. Fetch resource
    S3->>CloudFront: 19. Return resource
    CloudFront->>User: 20. Return protected content
```

### Flow Details

1. User visits CloudFront URL
2. Lambda@Edge checks for valid authentication cookie
3. If not authenticated, shows Google Sign-In button
4. User signs in with Google
5. Lambda@Edge verifies JWT token with Google certificates
6. Sets secure authentication cookie
7. User accesses protected content
