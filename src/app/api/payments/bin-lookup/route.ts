import { NextRequest, NextResponse } from 'next/server';

const STAX_API_BASE = 'https://apiprod.fattlabs.com';

// Common debit card BIN ranges (first 6 digits)
// This is a fallback if Stax doesn't return funding type
const DEBIT_BIN_PREFIXES = [
  // Visa Debit
  '400626', '400837', '402718', '402934', '403251', '403587', '404227', '404283',
  '404829', '405141', '405572', '405764', '406220', '406753', '406958', '407120',
  '407665', '408016', '408367', '408540', '408838', '409522', '409616', '410082',
  '410452', '411224', '412285', '412760', '414720', '414740', '417500', '418302',
  '419772', '419773', '420672', '421348', '421558', '421741', '422661', '423623',
  '424631', '426684', '427533', '428207', '428269', '428331', '428511', '428574',
  // Mastercard Debit  
  '516730', '516782', '517112', '517234', '518692', '519344', '520356', '521498',
  '522057', '522512', '523267', '524641', '525827', '526728', '527167', '528587',
  '529134', '530135', '530327', '531126', '532834', '533187', '534567', '535989',
  // Discover Debit
  '601100', '601103', '601105', '601108', '601110', '601120',
];

/**
 * GET /api/payments/bin-lookup - Look up if a payment method is debit
 * 
 * Uses Stax API to get payment method details, falls back to BIN database
 */
export async function GET(request: NextRequest) {
  try {
    const paymentMethodId = request.nextUrl.searchParams.get('payment_method_id');
    const bin = request.nextUrl.searchParams.get('bin');

    // Option 1: Look up by payment method ID via Stax API
    if (paymentMethodId) {
      const staxApiKey = process.env.STAX_API_KEY;
      
      if (staxApiKey) {
        try {
          const staxRes = await fetch(`${STAX_API_BASE}/payment-method/${paymentMethodId}`, {
            headers: {
              'Authorization': `Bearer ${staxApiKey}`,
              'Accept': 'application/json',
            },
          });

          if (staxRes.ok) {
            const pmData = await staxRes.json();
            console.log('Stax payment method data:', pmData);

            // Check various fields Stax might use for funding type
            const isDebit = 
              pmData.is_debit === true ||
              pmData.funding === 'debit' ||
              pmData.card_funding === 'debit' ||
              pmData.type === 'debit' ||
              (pmData.meta && pmData.meta.funding === 'debit');

            return NextResponse.json({
              isDebit,
              cardType: pmData.card_type || pmData.brand,
              lastFour: pmData.card_last_four,
              funding: pmData.funding || pmData.card_funding || (isDebit ? 'debit' : 'credit'),
              source: 'stax',
            });
          }
        } catch (staxErr) {
          console.error('Stax lookup error:', staxErr);
        }
      }
    }

    // Option 2: Look up by BIN (first 6 digits)
    if (bin && bin.length >= 6) {
      const binPrefix = bin.substring(0, 6);
      const isDebit = DEBIT_BIN_PREFIXES.some(prefix => binPrefix.startsWith(prefix));

      return NextResponse.json({
        isDebit,
        funding: isDebit ? 'debit' : 'credit',
        source: 'bin_database',
      });
    }

    // Option 3: Use external BIN lookup (binlist.net - free, no API key)
    if (bin && bin.length >= 6) {
      try {
        const binlistRes = await fetch(`https://lookup.binlist.net/${bin.substring(0, 6)}`, {
          headers: {
            'Accept-Version': '3',
          },
        });

        if (binlistRes.ok) {
          const binData = await binlistRes.json();
          const isDebit = binData.type === 'debit' || binData.prepaid === true;

          return NextResponse.json({
            isDebit,
            cardBrand: binData.scheme,
            cardType: binData.type,
            bank: binData.bank?.name,
            country: binData.country?.name,
            funding: isDebit ? 'debit' : 'credit',
            source: 'binlist',
          });
        }
      } catch (binlistErr) {
        console.log('Binlist lookup failed:', binlistErr);
      }
    }

    // Default: assume credit (higher fee is safer)
    return NextResponse.json({
      isDebit: false,
      funding: 'credit',
      source: 'default',
    });

  } catch (error) {
    console.error('BIN lookup error:', error);
    return NextResponse.json({
      isDebit: false,
      funding: 'credit',
      source: 'error',
    });
  }
}
