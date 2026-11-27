# Changelog

## 0.2.0

### Minor Changes

- The client always talks to `https://platform.yolla.io/api`. The `baseUrl` option and the `YOLLA_BASE_URL`
  environment variable are removed. The 403 error code for a blocked partner is now `partner_blocked`
  (was `reseller_blocked`). The docs name the API the Yolla Voice Partner API and write phone numbers as digits
  without a leading `+`.

## 0.1.0

Initial release: calls, balance, pricing, webhooks.
