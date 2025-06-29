# Audio Transcription Cloud Service - AWS Implementation Plan

## Overview
Convert the existing local audio transcription tool into a cost-effective cloud-based web service on AWS that allows users to upload audio files through a frontend website and receive text transcripts.

## Current State Analysis

### Existing Frontend Implementation ✅
The project already has a **production-ready React/TypeScript frontend** in `at-frontend-bolt/`:
- **Technology Stack**: React 18 + TypeScript + Vite + Tailwind CSS
- **UI Components**: Beautiful, responsive interface with drag-and-drop upload
- **Features**: Audio file preview, progress tracking, transcript editing, group management
- **Architecture**: Clean component structure with hooks and services
- **Status**: Fully functional UI with mock transcription service

### Existing Backend Implementation ✅
The project has a **local Python transcription service** in `audio-transcriber/`:
- **Technology**: Python with OpenAI Whisper integration
- **Features**: Audio processing, transcription, file management
- **Architecture**: Modular design with configurable settings
- **Status**: Working local implementation with iCloud integration

## AWS Architecture (Cost-Optimized)

### 1. System Components
- **Frontend**: React/TypeScript app deployed to AWS S3 + CloudFront (CDN)
- **Backend API**: FastAPI service on AWS Lambda + API Gateway (serverless)
- **File Storage**: AWS S3 for audio files and transcripts
- **Database**: AWS RDS PostgreSQL (t3.micro for dev, t3.small for prod)
- **Transcription**: OpenAI Whisper API (pay-per-use)
- **Job Queue**: AWS SQS for background processing
- **Authentication**: AWS Cognito for user management

### 2. AWS Service Stack (Cost-Conscious)
- **Frontend Hosting**: S3 + CloudFront (~$1-5/month)
- **Backend**: Lambda + API Gateway (~$5-20/month)
- **Database**: RDS PostgreSQL t3.micro (~$15/month)
- **File Storage**: S3 Standard (~$0.023/GB/month)
- **Queue**: SQS (~$0.40/month for 1M requests)
- **Authentication**: Cognito (~$0.55/month for 50K users)
- **Monitoring**: CloudWatch (free tier available)

### 3. Service Architecture
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Backend API   │    │  Transcription  │
│   (S3+CloudFront)│◄──►│   (Lambda)      │◄──►│   (Whisper API) │
│   [EXISTING]    │    │   [CONVERT]     │    │   [EXISTING]    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │                        │
                              ▼                        ▼
                       ┌─────────────────┐    ┌─────────────────┐
                       │   Database      │    │   File Storage  │
                       │   (RDS)         │    │   (S3)          │
                       └─────────────────┘    └─────────────────┘
```

## Cost Breakdown (Monthly Estimates)

### Development Phase (Low Usage)
- **S3 + CloudFront**: $1-3/month
- **Lambda + API Gateway**: $2-5/month (free tier covers most usage)
- **RDS t3.micro**: $15/month
- **SQS**: $0.40/month
- **Cognito**: $0.55/month
- **CloudWatch**: $0-2/month
- **Total**: ~$20-25/month

### Production Phase (Moderate Usage)
- **S3 + CloudFront**: $3-8/month
- **Lambda + API Gateway**: $10-30/month
- **RDS t3.small**: $30/month
- **SQS**: $1-2/month
- **Cognito**: $1-3/month
- **CloudWatch**: $5-10/month
- **Total**: ~$50-80/month

### Transcription Costs (Pay-per-use)
- **OpenAI Whisper API**: $0.006/minute
- **1 hour of audio**: $0.36
- **10 hours/month**: $3.60
- **100 hours/month**: $36.00

## Implementation Phases

### Phase 1: AWS Backend Development (Priority 1)
1. **Set up AWS Infrastructure**: Create IAM roles, VPC, security groups
2. **Convert to Lambda**: Transform existing Python logic to serverless functions
3. **Database Setup**: Deploy RDS PostgreSQL with proper security
4. **S3 Integration**: Set up file storage with proper permissions
5. **API Gateway**: Create RESTful API endpoints

### Phase 2: Frontend Integration (Priority 2)
1. **Deploy to S3**: Host React app on S3 with CloudFront CDN
2. **API Integration**: Replace mock service with Lambda API calls
3. **Authentication**: Integrate AWS Cognito for user management
4. **Real-time Updates**: Implement SQS polling for progress updates
5. **Error Handling**: Add proper error states and retry logic

### Phase 3: Production Deployment (Priority 3)
1. **Custom Domain**: Set up Route 53 with SSL certificate
2. **Monitoring**: Configure CloudWatch alarms and logging
3. **Backup Strategy**: Set up automated database backups
4. **Security Hardening**: Implement proper security policies
5. **Cost Monitoring**: Set up billing alerts and cost optimization

### Phase 4: Advanced Features (Priority 4)
1. **Batch Processing**: Multiple file upload and processing
2. **Export Options**: Multiple output formats (TXT, JSON, SRT, PDF)
3. **User Dashboard**: Advanced analytics and usage statistics
4. **Auto-scaling**: Configure Lambda concurrency and RDS scaling
5. **CDN Optimization**: Implement proper caching strategies

## AWS-Specific API Design

### Authentication (AWS Cognito)
- `POST /auth/register` - User registration via Cognito
- `POST /auth/login` - User login via Cognito
- `POST /auth/refresh` - Refresh JWT tokens
- `POST /auth/logout` - User logout
- `GET /auth/me` - Get current user info

### File Management (S3 Integration)
- `POST /api/upload` - Get presigned S3 URL for direct upload
- `GET /api/files` - List user's files from S3
- `GET /api/files/{id}` - Get file details
- `DELETE /api/files/{id}` - Delete file from S3
- `GET /api/files/{id}/download` - Get presigned download URL

### Transcription (Lambda + SQS)
- `POST /api/transcribe` - Start transcription job (adds to SQS)
- `GET /api/jobs` - List user's jobs
- `GET /api/jobs/{id}` - Get job status and progress
- `GET /api/jobs/{id}/transcript` - Get transcript from S3
- `PUT /api/jobs/{id}/transcript` - Update transcript
- `DELETE /api/jobs/{id}` - Delete job and associated files

### Groups (existing feature)
- `GET /api/groups` - List user's groups
- `POST /api/groups` - Create new group
- `PUT /api/groups/{id}` - Update group
- `DELETE /api/groups/{id}` - Delete group
- `POST /api/groups/{id}/jobs/{jobId}` - Add job to group
- `DELETE /api/groups/{id}/jobs/{jobId}` - Remove job from group

## Database Schema (RDS PostgreSQL)

### Users Table (Cognito Integration)
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cognito_user_id VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### Files Table (S3 Integration)
```sql
CREATE TABLE files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    file_size BIGINT NOT NULL,
    file_type VARCHAR(50) NOT NULL,
    s3_key VARCHAR(500) NOT NULL,
    s3_bucket VARCHAR(255) NOT NULL,
    duration_seconds INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);
```

### Jobs Table (SQS Integration)
```sql
CREATE TABLE jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    file_id UUID REFERENCES files(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    progress INTEGER DEFAULT 0,
    s3_transcript_key VARCHAR(500),
    transcript_text TEXT,
    error_message TEXT,
    language VARCHAR(10),
    model_used VARCHAR(50),
    sqs_message_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);
```

### Groups Table
```sql
CREATE TABLE groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    color VARCHAR(7) DEFAULT '#3B82F6',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### Job Groups Table (Many-to-Many)
```sql
CREATE TABLE job_groups (
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
    PRIMARY KEY (job_id, group_id)
);
```

## AWS Infrastructure Setup

### VPC Configuration
```yaml
VPC:
  CIDR: 10.0.0.0/16
  Subnets:
    - Public: 10.0.1.0/24 (for NAT Gateway)
    - Private: 10.0.2.0/24 (for RDS)
    - Private: 10.0.3.0/24 (for Lambda)
  Security Groups:
    - RDS: Allow Lambda access on port 5432
    - Lambda: Allow outbound to RDS, S3, SQS
```

### IAM Roles and Policies
```yaml
LambdaExecutionRole:
  - AWSLambdaBasicExecutionRole
  - S3ReadWritePolicy (for file access)
  - SQSFullAccess (for job processing)
  - RDSFullAccess (for database operations)

CognitoRole:
  - CognitoPowerUser (for user management)
```

### S3 Bucket Structure
```
audio-transcriber-bucket/
├── users/
│   └── {userId}/
│       ├── audio/
│       │   └── {fileId}.{ext}
│       └── transcripts/
│           └── {jobId}.{format}
├── temp/
│   └── {sessionId}/
└── public/
    └── frontend/
```

## Cost Optimization Strategies

### Development Phase
1. **Use AWS Free Tier**: 12 months of free services
2. **RDS t3.micro**: Smallest instance for development
3. **Lambda Free Tier**: 1M requests/month free
4. **S3 Free Tier**: 5GB storage free
5. **CloudFront Free Tier**: 1TB data transfer free

### Production Phase
1. **Reserved Instances**: Commit to 1-3 year terms for RDS
2. **S3 Lifecycle Policies**: Move old files to cheaper storage
3. **Lambda Optimization**: Minimize execution time and memory
4. **CloudFront Caching**: Reduce S3 requests
5. **Auto-scaling**: Scale down during low usage

### Monitoring and Alerts
1. **Billing Alerts**: Set up CloudWatch billing alarms
2. **Usage Monitoring**: Track Lambda invocations and S3 usage
3. **Cost Explorer**: Regular cost analysis and optimization
4. **Resource Tagging**: Proper tagging for cost allocation

## Security Considerations

### AWS Security Best Practices
1. **VPC Isolation**: Private subnets for sensitive resources
2. **IAM Least Privilege**: Minimal required permissions
3. **Encryption**: S3 server-side encryption, RDS encryption at rest
4. **WAF**: Web Application Firewall for API Gateway
5. **CloudTrail**: Audit logging for compliance

### Data Protection
1. **S3 Bucket Policies**: Restrict access to authenticated users
2. **CORS Configuration**: Allow only frontend domain
3. **Pre-signed URLs**: Time-limited access to files
4. **Database Encryption**: RDS encryption in transit and at rest

## Development Environment Setup

### Local Development
```bash
# Install AWS CLI and configure credentials
aws configure

# Install required tools
pip install boto3 fastapi uvicorn sqlalchemy psycopg2-binary
npm install -g aws-amplify-cli

# Set up local environment
export AWS_REGION=us-east-1
export AWS_PROFILE=default
```

### AWS Resources Setup
```bash
# Create S3 bucket
aws s3 mb s3://audio-transcriber-{unique-id}

# Create RDS instance
aws rds create-db-instance \
  --db-instance-identifier audio-transcriber-db \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --master-username admin \
  --master-user-password {secure-password}

# Create Cognito User Pool
aws cognito-idp create-user-pool \
  --pool-name audio-transcriber-users \
  --policies PasswordPolicy={MinimumLength=8}
```

## Deployment Strategy

### Frontend Deployment (S3 + CloudFront)
```bash
# Build React app
cd at-frontend-bolt
npm run build

# Deploy to S3
aws s3 sync dist/ s3://audio-transcriber-frontend

# Create CloudFront distribution
aws cloudfront create-distribution \
  --origin-domain-name audio-transcriber-frontend.s3.amazonaws.com
```

### Backend Deployment (Lambda + API Gateway)
```bash
# Package Lambda function
zip -r lambda-function.zip .

# Create Lambda function
aws lambda create-function \
  --function-name audio-transcriber-api \
  --runtime python3.9 \
  --handler app.handler \
  --zip-file fileb://lambda-function.zip

# Create API Gateway
aws apigateway create-rest-api \
  --name audio-transcriber-api
```

## Success Metrics

### Technical Metrics
- API response time < 200ms (Lambda cold start < 1s)
- File upload success rate > 99%
- Transcription accuracy > 95%
- System uptime > 99.9%

### Cost Metrics
- Monthly infrastructure cost < $50 (development)
- Monthly infrastructure cost < $100 (production)
- Cost per transcription < $0.50
- Storage cost per GB < $0.03

## Next Steps
1. **Set up AWS Account**: Create account and configure billing alerts
2. **Create Infrastructure**: Set up VPC, RDS, S3, and IAM roles
3. **Convert Backend**: Transform existing Python logic to Lambda functions
4. **Deploy Frontend**: Host React app on S3 with CloudFront
5. **Integrate Services**: Connect frontend to Lambda API
6. **Add Authentication**: Implement Cognito user management
7. **Test and Optimize**: Monitor costs and performance
8. **Go Live**: Deploy to production with proper monitoring 