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
        // The form now prefills the address from the last successful sign-in, so a test
        // that types into it has to start from a device nobody has signed in on.
        localStorage.clear();
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

        // The third argument marks this as a session call, which keeps the 401-renews-and-
        // retries interceptor out of a wrong-password response. See src/auth/session.js.
        expect(axios.post).toHaveBeenCalledWith(
            '/api/login',
            { email: 'test@example.com', password: 'password123' },
            { __isSessionCall: true }
        );

        // Resolve the promise and wait for login callback
        const session = { token: mockToken, refresh_token: 'refresh-abc', expires_in: 86400 };
        resolveMock({ data: session });

        // The whole payload is handed up, not just the access token: the refresh half is
        // what stops this screen from reappearing tomorrow.
        await waitFor(() => {
            expect(mockOnLogin).toHaveBeenCalledWith(session);
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

        expect(axios.post).toHaveBeenCalledWith(
            '/api/signup',
            { email: 'newuser@example.com', password: 'newpassword123' },
            { __isSessionCall: true }
        );

        await waitFor(() => {
            expect(screen.getByText('Account created! Please log in.')).toBeInTheDocument();
        });

        // Check it switches back to login view automatically
        expect(screen.getByText('Welcome back')).toBeInTheDocument();
    });

    it('prefills the address the last sign-in used, and nothing else', async () => {
        localStorage.setItem('alq:last-email', 'returning@example.com');

        render(<Auth onLogin={mockOnLogin} />);

        expect(screen.getByPlaceholderText('name@example.com')).toHaveValue('returning@example.com');
        // The passphrase is never stored — the refresh token exists precisely so it does
        // not have to be.
        expect(screen.getByPlaceholderText('••••••••')).toHaveValue('');
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

describe('Auth — the stay signed in choice', () => {
    const onLogin = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        sessionStorage.clear();
    });

    it('is offered on sign in, checked, and absent on sign up', async () => {
        render(<Auth onLogin={onLogin} />);

        expect(screen.getByLabelText(/stay signed in/i)).toBeChecked();

        // There is no session to keep yet on the signup branch, and a control that does
        // nothing is worse than an absent one.
        await userEvent.click(screen.getByRole('button', { name: /sign up/i }));

        expect(screen.queryByLabelText(/stay signed in/i)).not.toBeInTheDocument();
    });

    it('keeps the session and the address out of localStorage when unchecked', async () => {
        axios.post.mockResolvedValueOnce({
            data: { token: 'tok', refresh_token: 'ref', expires_in: 86400 }
        });

        render(<Auth onLogin={onLogin} />);

        await userEvent.click(screen.getByLabelText(/stay signed in/i));
        await userEvent.type(screen.getByPlaceholderText('name@example.com'), 'a@b.co');
        await userEvent.type(screen.getByPlaceholderText('••••••••'), 'password123');
        await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

        await waitFor(() => expect(onLogin).toHaveBeenCalled());

        expect(localStorage.getItem('alq:stay-signed-in')).toBe('false');
        // The choice is recorded before the address is, or the address lands in the wrong
        // store and outlives the session it belonged to.
        expect(localStorage.getItem('alq:last-email')).toBeNull();
        expect(sessionStorage.getItem('alq:last-email')).toBe('a@b.co');
    });

    it('leaves the session in localStorage when it stays checked', async () => {
        axios.post.mockResolvedValueOnce({
            data: { token: 'tok', refresh_token: 'ref', expires_in: 86400 }
        });

        render(<Auth onLogin={onLogin} />);

        await userEvent.type(screen.getByPlaceholderText('name@example.com'), 'a@b.co');
        await userEvent.type(screen.getByPlaceholderText('••••••••'), 'password123');
        await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

        await waitFor(() => expect(onLogin).toHaveBeenCalled());

        expect(localStorage.getItem('alq:last-email')).toBe('a@b.co');
    });
});
