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
