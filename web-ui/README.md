# Web Client

## Environment Setup

1. Create a `.env` file in the `web` directory
2. Add the following environment variables:

```env
# API Configuration
REACT_APP_API_URL=http://localhost:5000
```

You can customize these values based on your environment:
- Development: `http://localhost:5000`
- Production: Your production API URL

Note: When running in Docker, the API URL is automatically configured through the Docker environment.

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `REACT_APP_API_URL` | The base URL for the API endpoints | `http://localhost:5000` |
