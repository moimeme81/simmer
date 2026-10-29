# Accounts, households and sharing

- **Account → Invite someone** makes a one-time link (valid 7 days). Optionally it also adds the person to one of your households.
- A **household** shares its recipes and lists with every member. You can belong to several, or none. **Share what I add with**
  (Account page) sets which households receive your new recipes and lists by default.
- Anything can also be shared with individual people (Share button). A **meal** can be shared with specific people: it appears in their
  plan too, and sharing a meal also lets them open its recipe.
- Only the owner can delete or re-share something. Guests can tick items, add to lists and write notes.
- Passwords are stored with scrypt. Everyone on the instance can see each other's names (for sharing), so invite only people you trust.
- Simmer does not do HTTPS itself. Put it behind a reverse proxy before exposing it to the internet.
- Upgrading from a version without accounts: the first account you create becomes the owner of the existing recipes and lists.
  The old `AUTH_USER`/`AUTH_PASS` variables are ignored.
- Friends who run their own Simmer can be linked too: see [Linking Simmers](linking-simmers.md).

## Two-factor sign-in

Anyone can turn on two-factor sign-in in **Account → Two-factor sign-in**: scan the QR code with an authenticator app (Google Authenticator, Microsoft Authenticator, Aegis, 1Password, Authy…), enter the 6-digit code it shows, and save the ten **recovery codes** (copy or print them; they are shown once). From then on, signing in asks for the password and a code. A recovery code works once, in place of the app's code.

- It also covers the sidebar panel in Home Assistant and its companion app, which sign in the same way. API tokens (used by the Home Assistant integration and scripts) are not affected.
- Turning it off, or making new recovery codes, needs the password and a current code.
- If someone loses their phone and recovery codes, an admin can press **Reset 2FA** next to their name (Account → People on this Simmer). They then sign in with just their password and set it up again.
- Codes are standard time-based one-time passwords (RFC 6238); each code works once, and wrong guesses are rate-limited like wrong passwords. Keep your phone's clock on automatic time.
