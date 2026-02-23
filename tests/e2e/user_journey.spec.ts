import { test, expect } from '@playwright/test';
import fs from 'fs';

test.describe('End-to-End User Journey', () => {

    // Create a dummy image file for upload testing during runtime
    const dummyFilePath = 'tests/e2e/dummy_profile.jpg';

    test.beforeAll(() => {
        // Generate a quick dummy file buffer if it doesn't exist
        if (!fs.existsSync(dummyFilePath)) {
            fs.writeFileSync(dummyFilePath, Buffer.from('fake image data'));
        }
    });

    test.afterAll(() => {
        // Clean up the dummy file
        if (fs.existsSync(dummyFilePath)) {
            fs.unlinkSync(dummyFilePath);
        }
    });

    test('Critical Path: Login -> Dashboard -> Create Subject -> Profile -> Upload Image', async ({ page }) => {

        // --- 1. Navigate to Landing Page & Login ---
        await test.step('Navigate and Login', async () => {
            // Assuming frontend runs on localhost:5173 (Vite default)
            await page.goto('http://localhost:5173/');

            // The Navbar contains the "Sign In" button routing to /login
            await page.getByRole('link', { name: 'Sign In' }).click();

            // We should be on the /login view (Auth component)
            await expect(page).toHaveURL(/.*login/);

            const dynamicEmail = `e2e_${Date.now()}@example.com`;

            // Since the test DB might be persistent, let's create a fresh account first
            await page.getByRole('button', { name: "Don't have an account? Sign up" }).click();

            // Fill the registration form using the Auth component's exact placeholders
            await page.getByPlaceholder('name@example.com').fill(dynamicEmail);
            await page.getByPlaceholder('••••••••').fill('password123');

            // Submit registration
            await page.getByRole('button', { name: 'Create Account' }).click();

            // Wait for the backend to return success and swap the React component state back to Login
            await expect(page.getByText('Account created! Please log in.')).toBeVisible();

            // The Auth component switches back to the Login view automatically upon success. 
            // Re-fill the login form (since state clears usually, or it might persist depending on your exact implementation, better to be safe)
            await page.getByPlaceholder('name@example.com').fill(dynamicEmail);
            await page.getByPlaceholder('••••••••').fill('password123');

            // Submit login
            await page.getByRole('button', { name: 'Sign In' }).click();
            // Wait for navigation to the Dashboard
            await expect(page).toHaveURL('http://localhost:5173/');

            // Verify we arrived by checking for the Dashboard header
            await expect(page.getByRole('heading', { name: 'My Analysis' })).toBeVisible();
        });

        // --- 2. Dashboard: Create a New Subject ---
        await test.step('Create New Analysis Subject', async () => {
            // Find and click the "New Analysis" button in Dashboard header
            await page.getByRole('button', { name: 'New Analysis' }).click();

            // Wait for the PersonForm modal to appear
            await expect(page.getByRole('heading', { name: 'New Subject' })).toBeVisible();

            // Ensure the "Analyze & Save" button starts disabled since Identity is blank
            const saveButton = page.getByRole('button', { name: 'Analyze & Save' });
            await expect(saveButton).toBeDisabled();

            // Fill out the Name input
            await page.getByPlaceholder('Enter name...').fill('Playwright Test Subject');

            // Verify the button enabled out after filling the name
            await expect(saveButton).toBeEnabled();

            // Adjust the "Eros" slider dynamically
            // The labels are inside a div hierarchy, we can select the generic range input easily
            // Let's get the first slider for 'Eros' and change its value
            const erosSlider = page.locator('input[type="range"]').first();
            await erosSlider.fill('85');

            // Submit the form
            await saveButton.click();

            // Assert the modal closed 
            await expect(page.getByRole('heading', { name: 'New Subject' })).not.toBeVisible();

            // Assert the new subject card rendered onto the Dashboard grid
            await expect(page.getByRole('heading', { name: 'Playwright Test Subject' })).toBeVisible({ timeout: 10000 });
        });

        // --- 3. Profile: Upload Profile Picture ---
        await test.step('Navigate to Profile and Upload Image', async () => {
            // Click the Profile link in the Navbar
            await page.getByRole('link', { name: 'Profile' }).click();

            // Verify we landed on the Profile page
            await expect(page).toHaveURL(/.*profile/);
            await expect(page.getByRole('heading', { name: 'Account Settings' })).toBeVisible();

            // The Profile component has a hidden file input linked to the avatar
            // We locate the file input directly and upload our dummy file
            const fileInput = page.locator('input[type="file"]');

            // We set up a response interceptor before setting the file, to ensure the backend receives the multipart
            const uploadPromise = page.waitForResponse(response =>
                response.url().includes('/api/upload') && response.status() === 200
            );

            // Trigger the file upload
            await fileInput.setInputFiles(dummyFilePath);

            // Await network confirmation
            await uploadPromise;

            // Verify the success banner appears indicating the DOM updated correctly
            await expect(page.getByText('Image uploaded successfully')).toBeVisible();
        });

    });
});
