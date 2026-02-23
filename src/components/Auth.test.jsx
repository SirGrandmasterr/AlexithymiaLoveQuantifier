import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import Auth from './Auth';

vi.mock('axios');

describe('Auth Component', () => {
    const mockOnLogin = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders login view by default', () => {
        render(<Auth onLogin={mockOnLogin} />);

        expect(screen.getByText('Welcome back')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /don't have an account\? sign up/i })).toBeInTheDocument();
    });

    it('toggles to signup view when signup button is clicked', async () => {
        render(<Auth onLogin={mockOnLogin} />);

        const toggleButton = screen.getByRole('button', { name: /don't have an account\? sign up/i });
        await userEvent.click(toggleButton);

        expect(screen.getByText('Create your account')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /already have an account\? sign in/i })).toBeInTheDocument();
    });

    it('allows user to input email and password', async () => {
        render(<Auth onLogin={mockOnLogin} />);

        const emailInput = screen.getByPlaceholderText('name@example.com');
        const passwordInput = screen.getByPlaceholderText('••••••••');

        await userEvent.type(emailInput, 'test@example.com');
        await userEvent.type(passwordInput, 'password123');

        expect(emailInput).toHaveValue('test@example.com');
        expect(passwordInput).toHaveValue('password123');
    });

    it('handles successful login', async () => {
        const mockToken = 'fake-jwt-token';
        // Use an unresolved promise to control the flow so we can assert the loading state
        let resolveMock;
        const mockPromise = new Promise(resolve => {
            resolveMock = resolve;
        });
        axios.post.mockReturnValueOnce(mockPromise);

        render(<Auth onLogin={mockOnLogin} />);

        const emailInput = screen.getByPlaceholderText('name@example.com');
        const passwordInput = screen.getByPlaceholderText('••••••••');
        const submitButton = screen.getByRole('button', { name: /sign in/i });

        await userEvent.type(emailInput, 'test@example.com');
        await userEvent.type(passwordInput, 'password123');

        // Do not await the click immediately since test needs to check loading state
        userEvent.click(submitButton);

        // Now we can check if it's disabled and loading while the request is 'pending'
        await waitFor(() => {
            expect(submitButton).toBeDisabled();
            expect(submitButton).toHaveTextContent('Please wait...');
        });

        expect(axios.post).toHaveBeenCalledWith('/api/login', {
            email: 'test@example.com',
            password: 'password123'
        });

        // Resolve the promise and wait for login callback
        resolveMock({ data: { token: mockToken } });

        await waitFor(() => {
            expect(mockOnLogin).toHaveBeenCalledWith(mockToken);
        });
    });

    it('handles successful signup', async () => {
        axios.post.mockResolvedValueOnce({ data: { message: 'User created' } });

        render(<Auth onLogin={mockOnLogin} />);

        // Toggle to signup
        await userEvent.click(screen.getByRole('button', { name: /don't have an account\? sign up/i }));

        const emailInput = screen.getByPlaceholderText('name@example.com');
        const passwordInput = screen.getByPlaceholderText('••••••••');
        const submitButton = screen.getByRole('button', { name: /create account/i });

        await userEvent.type(emailInput, 'newuser@example.com');
        await userEvent.type(passwordInput, 'newpassword123');
        await userEvent.click(submitButton);

        expect(axios.post).toHaveBeenCalledWith('/api/signup', {
            email: 'newuser@example.com',
            password: 'newpassword123'
        });

        await waitFor(() => {
            expect(screen.getByText('Account created! Please log in.')).toBeInTheDocument();
        });

        // Check it switches back to login view automatically
        expect(screen.getByText('Welcome back')).toBeInTheDocument();
    });

    it('displays API error message correctly', async () => {
        const errorMessage = 'Invalid credentials';
        axios.post.mockRejectedValueOnce({
            response: { data: { error: errorMessage } }
        });

        render(<Auth onLogin={mockOnLogin} />);

        const emailInput = screen.getByPlaceholderText('name@example.com');
        const passwordInput = screen.getByPlaceholderText('••••••••');
        const submitButton = screen.getByRole('button', { name: /sign in/i });

        await userEvent.type(emailInput, 'wrong@example.com');
        await userEvent.type(passwordInput, 'wrongpassword');
        await userEvent.click(submitButton);

        await waitFor(() => {
            expect(screen.getByText(errorMessage)).toBeInTheDocument();
        });
        expect(submitButton).not.toBeDisabled();
    });

    it('displays a generic api error if response does not have an error message', async () => {
        axios.post.mockRejectedValueOnce(new Error('Network Error'));

        render(<Auth onLogin={mockOnLogin} />);

        const emailInput = screen.getByPlaceholderText('name@example.com');
        const passwordInput = screen.getByPlaceholderText('••••••••');
        const submitButton = screen.getByRole('button', { name: /sign in/i });

        await userEvent.type(emailInput, 'wrong@example.com');
        await userEvent.type(passwordInput, 'wrongpassword');
        await userEvent.click(submitButton);

        await waitFor(() => {
            expect(screen.getByText('An error occurred')).toBeInTheDocument();
        });
    });
});
