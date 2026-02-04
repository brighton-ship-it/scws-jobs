import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sendEmail, isResendConfigured } from '@/lib/messaging/email';
import { logEmail } from '@/lib/communications';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://scws-jobs.vercel.app';

/**
 * POST /api/invoices/[id]/send - Send invoice to customer via email
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Check email is configured
    if (!isResendConfigured()) {
      return NextResponse.json(
        { error: 'Email not configured. Set RESEND_API_KEY.' },
        { status: 500 }
      );
    }

    // Get the invoice with customer details
    const { data: invoice, error } = await supabase
      .from('invoices')
      .select(`
        *,
        customer:customers (id, name, email, phone),
        items:invoice_items (*)
      `)
      .eq('id', id)
      .single();

    if (error || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    if (!invoice.customer?.email) {
      return NextResponse.json(
        { error: 'Customer has no email address' },
        { status: 400 }
      );
    }

    // Generate pay link
    const payLink = `${APP_URL}/portal/invoices/${id}/pay`;

    // Build email content
    const formatCurrency = (amount: number) => 
      new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);

    const itemsHtml = invoice.items
      .sort((a: any, b: any) => a.sort_order - b.sort_order)
      .map((item: any) => `
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #eee;">${item.description}</td>
          <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity}</td>
          <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">${formatCurrency(item.unit_price)}</td>
          <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">${formatCurrency(item.total)}</td>
        </tr>
      `)
      .join('');

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #1f3b4d; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
    <h1 style="margin: 0; font-size: 24px;">Invoice #${invoice.invoice_number}</h1>
    <p style="margin: 5px 0 0; opacity: 0.9;">Southern California Well Service</p>
  </div>
  
  <div style="background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; border-top: none;">
    <p>Hi ${invoice.customer.name?.split(' ')[0] || 'Customer'},</p>
    
    <p>Please find your invoice details below:</p>
    
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <thead>
        <tr style="background: #1f3b4d; color: white;">
          <th style="padding: 10px; text-align: left;">Description</th>
          <th style="padding: 10px; text-align: center;">Qty</th>
          <th style="padding: 10px; text-align: right;">Price</th>
          <th style="padding: 10px; text-align: right;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="3" style="padding: 8px; text-align: right; font-weight: 500;">Subtotal:</td>
          <td style="padding: 8px; text-align: right;">${formatCurrency(invoice.subtotal)}</td>
        </tr>
        <tr>
          <td colspan="3" style="padding: 8px; text-align: right; font-weight: 500;">Tax (${invoice.tax_rate}%):</td>
          <td style="padding: 8px; text-align: right;">${formatCurrency(invoice.tax_amount)}</td>
        </tr>
        <tr style="background: #1f3b4d; color: white;">
          <td colspan="3" style="padding: 12px; text-align: right; font-weight: bold; font-size: 16px;">Total Due:</td>
          <td style="padding: 12px; text-align: right; font-weight: bold; font-size: 16px;">${formatCurrency(invoice.total)}</td>
        </tr>
      </tfoot>
    </table>
    
    ${invoice.due_date ? `<p><strong>Due Date:</strong> ${new Date(invoice.due_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>` : ''}
    
    ${invoice.notes ? `<p style="background: #fff; padding: 15px; border-radius: 4px; border-left: 4px solid #1f3b4d;"><strong>Note:</strong> ${invoice.notes}</p>` : ''}
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="${payLink}" style="display: inline-block; background: #4e9271; color: white; padding: 15px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">Pay Now Online</a>
    </div>
    
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
    
    <p style="font-size: 14px; color: #666;">
      <strong>Payment Methods:</strong><br>
      • Credit/Debit Card (online)<br>
      • ACH Bank Transfer (online)<br>
      • Check (mail to: 1077 Main St, Ramona, CA 92065)<br>
      • Call to pay by phone: (760) 440-8520
    </p>
  </div>
  
  <div style="background: #1f3b4d; color: white; padding: 15px; text-align: center; border-radius: 0 0 8px 8px; font-size: 12px;">
    <p style="margin: 0;">Southern California Well Service</p>
    <p style="margin: 5px 0 0; opacity: 0.8;">License C-57 #1011552 | (760) 440-8520 | brighton@scwellservice.com</p>
  </div>
</body>
</html>
    `;

    const textContent = `
Invoice #${invoice.invoice_number} from Southern California Well Service

Hi ${invoice.customer.name?.split(' ')[0] || 'Customer'},

Amount Due: ${formatCurrency(invoice.total)}
${invoice.due_date ? `Due Date: ${new Date(invoice.due_date).toLocaleDateString()}` : ''}

Pay online: ${payLink}

Or call (760) 440-8520 to pay by phone.

Thank you for your business!
Southern California Well Service
    `.trim();

    // Send the email
    const result = await sendEmail({
      to: invoice.customer.email,
      subject: `Invoice #${invoice.invoice_number} from Southern California Well Service - ${formatCurrency(invoice.total)}`,
      html,
      text: textContent,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: 'Failed to send email', details: result.error },
        { status: 500 }
      );
    }

    // Update invoice status and sent_at
    await supabase
      .from('invoices')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    // Log the communication
    try {
      await logEmail({
        customerId: invoice.customer_id,
        direction: 'outbound',
        subject: `Invoice #${invoice.invoice_number}`,
        preview: `Invoice for ${formatCurrency(invoice.total)} sent`,
        status: 'sent',
        referenceType: 'invoice',
        referenceId: id,
      });
    } catch (logError) {
      console.error('Failed to log email:', logError);
      // Don't fail the request if logging fails
    }

    return NextResponse.json({
      success: true,
      messageId: result.messageId,
      sentTo: invoice.customer.email,
    });
  } catch (error) {
    console.error('Send invoice error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
