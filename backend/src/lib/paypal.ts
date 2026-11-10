/**
 * PayPal integration via the official @paypal/paypal-server-sdk.
 * The SDK handles OAuth2 client-credentials token exchange and refresh automatically.
 */
import {
  Client,
  Environment,
  OrdersController,
  CheckoutPaymentIntent,
  ApiError,
} from '@paypal/paypal-server-sdk';

// ─── Singleton SDK client ────────────────────────────────────────────────────
function buildClient(): Client {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      'PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set in environment variables.'
    );
  }

  return new Client({
    clientCredentialsAuthCredentials: {
      oAuthClientId: clientId,
      oAuthClientSecret: clientSecret,
    },
    environment: Environment.Sandbox,
  });
}

let _client: Client | null = null;
export function getPayPalClient(): Client {
  if (!_client) _client = buildClient();
  return _client;
}

export function getOrdersController(): OrdersController {
  return new OrdersController(getPayPalClient());
}

// ─── Re-export types the routes need ────────────────────────────────────────
export { CheckoutPaymentIntent, ApiError };

// ─── URL config ─────────────────────────────────────────────────────────────
export const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';
