import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { MortgageCalculator } from './MortgageCalculator';

describe('MortgageCalculator', () => {
    it('allows ordinary replacement typing and normalizes bounds on blur', async () => {
        const user = userEvent.setup();
        render(<MortgageCalculator />);

        const price = screen.getByLabelText(/purchase price/i);
        const downPayment = screen.getByLabelText(/down payment/i);
        const rate = screen.getByLabelText(/interest rate/i);

        await user.clear(price);
        await user.type(price, '650000');
        expect(price).toHaveValue(650000);

        fireEvent.change(price, { target: { value: '1' } });
        expect(price).toHaveValue(1);
        fireEvent.blur(price);
        fireEvent.change(downPayment, { target: { value: '99' } });
        expect(downPayment).toHaveValue(99);
        fireEvent.blur(downPayment);
        fireEvent.change(rate, { target: { value: '30' } });
        expect(rate).toHaveValue(30);
        fireEvent.blur(rate);

        expect(price).toHaveValue(100000);
        expect(downPayment).toHaveValue(80);
        expect(rate).toHaveValue(15);
        expect(screen.getByText(/inputs are limited to/i)).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent(/estimated monthly payment/i);
        expect(screen.getByRole('status')).not.toHaveTextContent(/nan|infinity/i);
    });
});
