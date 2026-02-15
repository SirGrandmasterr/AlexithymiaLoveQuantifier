# **LoveMetrics (Alexithymia Love Quantifier)**

This guide will help you set up the LoveMetrics app locally, moving it from the browser Canvas to your machine, and pushing it to GitHub.

## **Prerequisites**

* [Node.js](https://nodejs.org/) (Version 16 or higher)  
* [Git](https://git-scm.com/)  
* [Docker](https://www.docker.com/) (Optional, for containerized setup)

## **Step 1: Initialize the Project**

Open your terminal and run the following commands to create a new React project using Vite:  
npm create vite@latest love-metrics \-- \--template react  
cd love-metrics

## **Step 2: Install Dependencies**

Install the necessary packages, including Tailwind CSS and Lucide React (used for the icons):  
\# Install standard dependencies  
npm install

\# Install Lucide React icons  
npm install lucide-react

\# Install Tailwind CSS and its peer dependencies  
npm install \-D tailwindcss postcss autoprefixer  
npx tailwindcss init \-p

## **Step 3: Configure Tailwind CSS**

1. Open tailwind.config.js in your code editor and replace content: \[\] with:  
   export default {  
     content: \[  
       "./index.html",  
       "./src/\*\*/\*.{js,ts,jsx,tsx}",  
     \],  
     theme: {  
       extend: {},  
     },  
     plugins: \[\],  
   }

2. Open src/index.css and **replace everything** with these directives:  
   @tailwind base;  
   @tailwind components;  
   @tailwind utilities;

## **Step 4: Transfer the Code**

1. Open src/App.jsx in your local project.  
2. **Copy the entire code** from the Canvas "App.jsx" file.  
3. **Paste it** into your local src/App.jsx, replacing the existing content.  
4. You may delete src/App.css if it exists, as we are using Tailwind classes directly.

## **Step 5: Run the App**

You can now start the development server:  
npm run dev

## **Step 6: Save to GitHub**

1. Create a new repository on GitHub (e.g., named love-metrics).  
2. Run these commands in your project folder:

git init  
git add .  
git commit \-m "Initial commit: LoveMetrics app"  
git branch \-M main  
git remote add origin \[https://github.com/\](https://github.com/)\<YOUR-USERNAME\>/love-metrics.git  
git push \-u origin main

## **Using the Makefile**

If you added the Makefile to your project root, you can use these shortcuts:

* make install: Installs all dependencies.  
* make dev: Starts the local development server.  
* make build: Builds the app for production.

## **Docker Setup**

If you prefer using Docker, you can run the application in a container without installing Node.js locally.

1. **Build and Run**:  
   docker-compose up \--build

2. **Access the App**:  
   Open [http://localhost:8080](https://www.google.com/search?q=http://localhost:8080) in your browser.  
3. **Stop the Container**:  
   docker-compose down  
