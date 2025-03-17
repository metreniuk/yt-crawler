# Use an official Node runtime as the base image
FROM oven/bun:latest

# Set the working directory in the container
WORKDIR /app

# Copy the package.json and package-lock.json files from the current directory
# into the container's working directory.
COPY package.json ./
COPY bun.lockb ./

# Install dependencies
RUN bun install

# Copy the rest of the application code into the container
COPY ./src/ ./src/

# Expose the port that the app runs on
EXPOSE 3000

# Command to run the application
CMD ["bun", "run", "./src/index.ts", "consumer"]
