import { render } from '@react-email/render';
import { QuoteSentEmail } from '../src/emails/quote-sent';
import * as fs from 'fs';

async function main() {
const html = render(QuoteSentEmail({
  customerName: 'Brighton',
  quoteNumber: 'QT-2026-00042',
  totalAmount: '$3,850.00',
  validUntil: 'February 16, 2026',
  jobDescription: 'Well Pump Replacement - 13736 Crystallite Ln, Valley Center',
  lineItems: [
    { description: 'Grundfos 25S50 Submersible Pump', quantity: 1, unitPrice: '$1,850.00', total: '$1,850.00' },
    { description: 'Franklin 1HP Motor', quantity: 1, unitPrice: '$650.00', total: '$650.00' },
    { description: 'Pitless Adapter (Stainless)', quantity: 1, unitPrice: '$125.00', total: '$125.00' },
    { description: 'Wire & Fittings', quantity: 1, unitPrice: '$275.00', total: '$275.00' },
    { description: 'Labor - Installation', quantity: 6, unitPrice: '$150.00', total: '$900.00' },
    { description: 'Permit & Inspection', quantity: 1, unitPrice: '$50.00', total: '$50.00' },
  ],
  approveUrl: 'https://scws-jobs.vercel.app/quotes/42/approve',
  pdfUrl: 'https://scws-jobs.vercel.app/quotes/42/pdf',
}));

fs.writeFileSync('/tmp/scws-quote-email.html', html);
console.log('Quote email rendered to /tmp/scws-quote-email.html');
}

main();
