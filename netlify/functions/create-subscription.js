// netlify/functions/create-subscription.js
//
// ─────────────────────────────────────────────────────────────────
// SETUP INSTRUCTIONS:
//
// 1. In your Netlify dashboard → Site settings → Environment variables, add:
//    STRIPE_SECRET_KEY   →  sk_live_YOUR_SECRET_KEY (from Stripe dashboard)
//    STRIPE_PRICE_ID     →  price_XXXXXXXXXXXX
//
// To get your STRIPE_PRICE_ID:
//   Stripe Dashboard → Products → Create product → Add $8/month price
//   Copy the "Price ID" (starts with price_)
//
// 2. Install the Stripe npm package. Create a package.json in the root of
//    your repo if you don't have one:
//      { "dependencies": { "stripe": "^14.0.0" } }
//    Netlify will auto-install it on deploy.
// ─────────────────────────────────────────────────────────────────

const Stripe = require('stripe');

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const stripe = Stripe('sk_test_51TDYWxDOs37ggkjVqpQruO3uhzvcL7Wc5gbBQCwpuNV8kHxefwHFA7jxvRqoaRXDqdooSz7EWPAEx57gsrAA8D8500EadWiJJT');
  const PRICE_ID = process.env.STRIPE_PRICE_ID || 'price_1TEFV7DOs37ggkjVAoMxd9Jq';

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { paymentMethodId, email, name } = body;

  if (!paymentMethodId || !email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  try {
    // 1. Create or retrieve a Stripe customer
    const existingCustomers = await stripe.customers.list({ email, limit: 1 });
    let customer;

    if (existingCustomers.data.length > 0) {
      customer = existingCustomers.data[0];
      // Attach the new payment method
      await stripe.paymentMethods.attach(paymentMethodId, { customer: customer.id });
    } else {
      customer = await stripe.customers.create({
        email,
        name,
        payment_method: paymentMethodId,
      });
    }

    // 2. Set as default payment method
    await stripe.customers.update(customer.id, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    // 3. Create the subscription
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: PRICE_ID }],
      payment_settings: {
        payment_method_types: ['card'],
        save_default_payment_method: 'on_subscription',
      },
      expand: ['latest_invoice.payment_intent'],
    });

    const invoice = subscription.latest_invoice;
    const paymentIntent = invoice.payment_intent;

    // 4. Handle payment status
    if (paymentIntent.status === 'requires_action') {
      // 3D Secure needed — send client secret back to frontend
      return {
        statusCode: 200,
        body: JSON.stringify({
          requiresAction: true,
          clientSecret: paymentIntent.client_secret,
        }),
      };
    }

    if (paymentIntent.status === 'succeeded') {
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, subscriptionId: subscription.id }),
      };
    }

    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Payment failed. Please check your card details.' }),
    };

  } catch (err) {
    console.error('Stripe error:', err.message);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
