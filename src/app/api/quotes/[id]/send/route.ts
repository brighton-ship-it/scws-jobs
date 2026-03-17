import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { sendEmail, isResendConfigured } from '@/lib/messaging/email';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { randomBytes } from 'crypto';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://scws-jobs.vercel.app';

// Get or create portal token for customer
async function getOrCreatePortalToken(supabase: any, customerId: string): Promise<string> {
  // Check for existing non-expired token
  const { data: existing } = await supabase
    .from('portal_tokens')
    .select('token')
    .eq('customer_id', customerId)
    .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (existing?.token) {
    return existing.token;
  }

  // Create new token (valid for 1 year)
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  await supabase.from('portal_tokens').insert({
    customer_id: customerId,
    token,
    expires_at: expiresAt.toISOString(),
  });

  return token;
}

// Generate PDF for attachment
async function generateQuotePDF(quote: any): Promise<Buffer> {
  const items = (quote.items || []).sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const { width, height } = page.getSize();
  
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  
  const primaryColor = rgb(0.12, 0.23, 0.30);
  const grayColor = rgb(0.4, 0.4, 0.4);
  const lightGray = rgb(0.6, 0.6, 0.6);

  let y = height - 50;

  // Header
  page.drawText('QUOTE', { x: 50, y, size: 28, font: helveticaBold, color: primaryColor });
  page.drawText(`#${quote.quote_number}`, { x: 50, y: y - 25, size: 14, font: helvetica, color: lightGray });

  // Company info
  const companyX = width - 200;
  page.drawText('Southern California Well Service', { x: companyX, y, size: 12, font: helveticaBold, color: primaryColor });
  page.drawText('1077 Main St, Ramona, CA 92065', { x: companyX, y: y - 15, size: 9, font: helvetica, color: grayColor });
  page.drawText('(760) 440-8520', { x: companyX, y: y - 27, size: 9, font: helvetica, color: grayColor });

  y -= 80;

  // Customer
  page.drawText('CUSTOMER', { x: 50, y, size: 9, font: helveticaBold, color: lightGray });
  y -= 15;
  page.drawText(quote.customer?.name || 'N/A', { x: 50, y, size: 11, font: helveticaBold, color: primaryColor });
  y -= 14;
  if (quote.customer?.email) {
    page.drawText(quote.customer.email, { x: 50, y, size: 9, font: helvetica, color: grayColor });
    y -= 12;
  }

  // Property
  if (quote.property) {
    page.drawText('PROPERTY', { x: 300, y: y + 41, size: 9, font: helveticaBold, color: lightGray });
    page.drawText(quote.property.address || '', { x: 300, y: y + 26, size: 10, font: helvetica, color: grayColor });
    page.drawText(quote.property.city || '', { x: 300, y: y + 14, size: 10, font: helvetica, color: grayColor });
  }

  y -= 30;

  // Table header
  page.drawRectangle({ x: 50, y: y - 5, width: width - 100, height: 20, color: rgb(0.95, 0.95, 0.95) });
  page.drawText('Description', { x: 55, y, size: 9, font: helveticaBold, color: grayColor });
  page.drawText('Qty', { x: 350, y, size: 9, font: helveticaBold, color: grayColor });
  page.drawText('Price', { x: 400, y, size: 9, font: helveticaBold, color: grayColor });
  page.drawText('Total', { x: 480, y, size: 9, font: helveticaBold, color: grayColor });

  y -= 25;

  const formatCurrency = (amount: number) => '$' + amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  for (const item of items) {
    const desc = (item.description || '').substring(0, 50);
    page.drawText(desc, { x: 55, y, size: 9, font: helvetica, color: primaryColor });
    page.drawText(String(item.quantity || 1), { x: 355, y, size: 9, font: helvetica, color: grayColor });
    page.drawText(formatCurrency(item.unit_price || 0), { x: 395, y, size: 9, font: helvetica, color: grayColor });
    page.drawText(formatCurrency(item.total || 0), { x: 475, y, size: 9, font: helvetica, color: grayColor });
    y -= 18;
    if (y < 150) break;
  }

  y -= 10;
  page.drawLine({ start: { x: 390, y: y + 5 }, end: { x: width - 50, y: y + 5 }, thickness: 1, color: rgb(0.9, 0.9, 0.9) });

  y -= 10;
  page.drawText('Subtotal:', { x: 400, y, size: 10, font: helvetica, color: grayColor });
  page.drawText(formatCurrency(quote.subtotal || 0), { x: 475, y, size: 10, font: helvetica, color: primaryColor });

  y -= 15;
  page.drawText(`Tax (${quote.tax_rate || 0}%):`, { x: 400, y, size: 10, font: helvetica, color: grayColor });
  page.drawText(formatCurrency(quote.tax_amount || 0), { x: 475, y, size: 10, font: helvetica, color: primaryColor });

  y -= 20;
  page.drawText('Total:', { x: 400, y, size: 14, font: helveticaBold, color: primaryColor });
  page.drawText(formatCurrency(quote.total || 0), { x: 470, y, size: 14, font: helveticaBold, color: primaryColor });

  if (quote.notes) {
    y -= 40;
    page.drawText('NOTES', { x: 50, y, size: 9, font: helveticaBold, color: lightGray });
    y -= 15;
    page.drawText(quote.notes.substring(0, 80), { x: 50, y, size: 9, font: helvetica, color: grayColor });
  }

  page.drawText('Thank you for your business!', { x: 50, y: 50, size: 10, font: helvetica, color: lightGray });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

/**
 * POST /api/quotes/[id]/send - Send quote to customer via email
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const emailOverride = body?.email;
    const supabase = createServiceClient();

    // Check email is configured
    if (!isResendConfigured()) {
      return NextResponse.json(
        { error: 'Email not configured. Set RESEND_API_KEY.' },
        { status: 500 }
      );
    }

    // Get the quote with customer and items
    const { data: quote, error } = await supabase
      .from('quotes')
      .select(`
        *,
        customer:customers (id, name, email, phone),
        property:properties (address, city),
        items:quote_items (*)
      `)
      .eq('id', id)
      .single();

    if (error || !quote) {
      return NextResponse.json({ error: 'Quote not found' }, { status: 404 });
    }

    const recipientEmail = emailOverride || quote.customer?.email;
    if (!recipientEmail) {
      return NextResponse.json(
        { error: 'Customer has no email address' },
        { status: 400 }
      );
    }

    // Get or create portal token for online quote viewing
    const portalToken = await getOrCreatePortalToken(supabase, quote.customer.id);
    const quoteViewUrl = `${APP_URL}/portal/${portalToken}/quotes/${id}`;

    // Build email content
    const formatCurrency = (amount: number) => 
      new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);

    const itemsHtml = (quote.items || [])
      .sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
      .map((item: any) => `
        <tr>
          <td style="padding: 12px 8px; border-bottom: 1px solid #eee;">${item.description}${item.item_description ? `<br><span style="color: #666; font-size: 13px;">${item.item_description}</span>` : ''}</td>
          <td style="padding: 12px 8px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity}</td>
          <td style="padding: 12px 8px; border-bottom: 1px solid #eee; text-align: right;">${formatCurrency(item.unit_price)}</td>
          <td style="padding: 12px 8px; border-bottom: 1px solid #eee; text-align: right;">${formatCurrency(item.total)}</td>
        </tr>
      `)
      .join('');

    const validUntilText = quote.valid_until 
      ? `This quote is valid until <strong>${new Date(quote.valid_until).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</strong>.`
      : '';

    const propertyText = quote.property 
      ? `<p style="color: #666; margin: 5px 0;">Property: ${quote.property.address}, ${quote.property.city}</p>`
      : '';

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #1f3b4d; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
    <h1 style="margin: 0; font-size: 24px;">Quote #${quote.quote_number}</h1>
    <p style="margin: 5px 0 0; opacity: 0.9;">Southern California Well Service</p>
  </div>
  
  <div style="background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; border-top: none;">
    <p style="margin: 0 0 15px;">Hello ${quote.customer.name},</p>
    <p style="margin: 0 0 15px;">Thank you for your interest in our services! Please find your quote details below.</p>
    ${propertyText}
  </div>

  <div style="padding: 20px; border: 1px solid #e5e7eb; border-top: none;">
    <h2 style="margin: 0 0 15px; font-size: 18px; color: #1f3b4d;">Quote Details</h2>
    
    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
      <thead>
        <tr style="background: #f3f4f6;">
          <th style="padding: 12px 8px; text-align: left; font-weight: 600;">Description</th>
          <th style="padding: 12px 8px; text-align: center; font-weight: 600;">Qty</th>
          <th style="padding: 12px 8px; text-align: right; font-weight: 600;">Price</th>
          <th style="padding: 12px 8px; text-align: right; font-weight: 600;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>

    <div style="margin-top: 20px; padding-top: 15px; border-top: 2px solid #e5e7eb;">
      <table style="width: 100%; font-size: 14px;">
        <tr>
          <td style="padding: 5px 0;">Subtotal:</td>
          <td style="padding: 5px 0; text-align: right;">${formatCurrency(quote.subtotal)}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0;">Tax (${quote.tax_rate}%):</td>
          <td style="padding: 5px 0; text-align: right;">${formatCurrency(quote.tax_amount)}</td>
        </tr>
        <tr style="font-size: 18px; font-weight: bold;">
          <td style="padding: 10px 0; border-top: 2px solid #1f3b4d;">Total:</td>
          <td style="padding: 10px 0; text-align: right; border-top: 2px solid #1f3b4d; color: #1f3b4d;">${formatCurrency(quote.total)}</td>
        </tr>
      </table>
    </div>
  </div>

  ${quote.notes ? `
  <div style="padding: 15px 20px; border: 1px solid #e5e7eb; border-top: none; background: #fffbeb;">
    <p style="margin: 0; font-size: 14px;"><strong>Notes:</strong> ${quote.notes}</p>
  </div>
  ` : ''}

  <div style="padding: 20px; border: 1px solid #e5e7eb; border-top: none; text-align: center;">
    <p style="margin: 0 0 15px;">${validUntilText}</p>
    <p style="margin: 0 0 20px;">View your quote online to approve it with an electronic signature, or call us with questions.</p>
    <a href="${quoteViewUrl}" style="display: inline-block; background: #4e9271; color: white; text-decoration: none; padding: 14px 35px; border-radius: 6px; font-weight: 600; font-size: 16px; margin-bottom: 12px;">
      View Quote Online
    </a>
    <br>
    <a href="tel:7604408520" style="display: inline-block; background: #1f3b4d; color: white; text-decoration: none; padding: 12px 30px; border-radius: 6px; font-weight: 600; margin-top: 8px;">
      Call (760) 440-8520
    </a>
  </div>

  <div style="padding: 20px; text-align: center; color: #666; font-size: 12px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; background: #f9fafb;">
    <p style="margin: 0 0 5px;"><strong>Southern California Well Service</strong></p>
    <p style="margin: 0 0 5px;">1077 Main St, Ramona, CA 92065</p>
    <p style="margin: 0;">(760) 440-8520 • brighton@scwellservice.com</p>
  </div>
</body>
</html>
`;

    // Generate PDF attachment
    const pdfBuffer = await generateQuotePDF(quote);

    // Send email with PDF attachment
    const result = await sendEmail({
      to: recipientEmail,
      subject: `Quote #${quote.quote_number} from Southern California Well Service`,
      html,
      attachments: [
        {
          filename: `Quote-${quote.quote_number}.pdf`,
          content: pdfBuffer,
        },
      ],
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to send email' },
        { status: 500 }
      );
    }

    // Update quote status to sent
    await supabase
      .from('quotes')
      .update({ 
        status: 'sent',
        sent_at: new Date().toISOString()
      })
      .eq('id', id);

    return NextResponse.json({ 
      success: true,
      message: `Quote sent to ${recipientEmail}`
    });
  } catch (error) {
    console.error('Quote send error:', error);
    return NextResponse.json(
      { error: 'Failed to send quote' },
      { status: 500 }
    );
  }
}
