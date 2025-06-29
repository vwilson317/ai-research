# Frontend Docker Setup

This directory contains Docker configuration for the React/Vite frontend application.

## Files Created

- `Dockerfile` - Production build with multi-stage optimization
- `Dockerfile.dev` - Development environment with hot reloading
- `docker-compose.yml` - Orchestration for both production and development
- `nginx.conf` - Nginx configuration for serving the production build
- `.dockerignore` - Excludes unnecessary files from build context

## Local Development Setup (Without Docker)

If you prefer to run the frontend locally without Docker:

### Prerequisites

- Node.js 18 or higher
- npm (comes with Node.js)
- Vite (install globally): `npm install -g create-vite`

### Setup Steps

1. **Navigate to the frontend directory:**
   ```bash
   cd at-frontend-bolt
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the development server:**
   ```bash
   npm run dev
   ```

4. **Access the application:**
   The development server will start at `http://localhost:5173`

### Available Scripts

- `npm run dev` - Start development server with hot reloading
- `npm run build` - Build for production
- `npm run preview` - Preview production build locally
- `npm run lint` - Run ESLint

## Docker Usage

### Production Build

To run the production version:

```bash
# Build and start the production container
docker-compose up --build

# Or run in detached mode
docker-compose up -d --build
```

The application will be available at `http://localhost:3000`

### Development Mode

To run the development version with hot reloading:

```bash
# Start development environment
docker-compose --profile dev up --build

# Or run in detached mode
docker-compose --profile dev up -d --build
```

The development server will be available at `http://localhost:5173`

### Individual Commands

```bash
# Build the production image
docker build -t frontend-prod .

# Build the development image
docker build -f Dockerfile.dev -t frontend-dev .

# Run production container
docker run -p 3000:80 frontend-prod

# Run development container
docker run -p 5173:5173 -v $(pwd):/app frontend-dev
```

## Features

- **Multi-stage build** for optimized production images
- **Nginx** serving for production with proper caching and security headers
- **Hot reloading** in development mode
- **Volume mounting** for development to enable live code changes
- **Network isolation** with custom bridge network
- **Gzip compression** and static asset caching in production

## Environment Variables

The application uses the following environment variables:
- `NODE_ENV` - Set to `production` or `development`

## Troubleshooting

If you encounter issues:

1. **Port conflicts**: Change the port mappings in `docker-compose.yml`
2. **Build failures**: Ensure all dependencies are properly listed in `package.json`
3. **Permission issues**: Run with appropriate user permissions
4. **Hot reload not working**: Ensure volumes are properly mounted in development mode
5. **Local dev issues**: Make sure Node.js version is 18+ and all dependencies are installed 