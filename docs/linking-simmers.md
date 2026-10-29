# Linking Simmers

Run Simmer for yourself and a friend runs his own? Link the two servers and they act like one: everyone on both Simmers shows up in every **Share with** list, and you share recipes, shopping lists, meals and whole collections person to person. Each of you keeps your own server, accounts and data.

## How linking works

Every Simmer has its own long **key** (Account → Linked Simmers → *This Simmer's key*). Linking needs **both admins to hand each other their key**, so it can only happen when the two of you are really in touch. Both servers must be reachable from each other (use https addresses).

Say Chris (server A) and Marie (server B) want to link:

1. **Swap keys and addresses** (privately, any way you like). Chris copies A's key and sends it, with A's address, to Marie. Marie does the same with B's.
2. **Chris asks.** On A: Account → Linked Simmers → *Link to another Simmer*. He enters B's address and **B's key**, then *Ask to link*. A now shows "Waiting for the admin of B to enter your key".
3. **Marie is notified.** B's admin sees a banner ("Another Simmer wants to link with yours") and, on the Account page, a request from A.
4. **Marie accepts.** She pastes **A's key** and presses *Accept and link*. If the key is wrong, nothing happens and the request stays.
5. **Linked.** Both sides now show "Linked". The two servers exchange fresh keys of their own for the link, so the original keys only start a link and never carry day-to-day traffic. Press **Test** on either side to check.

Marie can also *Decline* a request, and Chris can *Cancel* one still waiting. *Unlink* removes the link on both sides, along with everything shared across it. *Make a new key* changes the key for new links without touching existing ones. Only admins can do any of this.

## After linking: share as if on one server

- **People:** everyone on the other Simmer appears in the normal **Share** dialog of a recipe or shopping list, and in a meal's sharing, under *On linked Simmers*. For a collection, use *Share with another Simmer* on the Recipes page.
- **Opt-in, one thing at a time.** Nothing is shared unless you tick someone. Untick them to stop; it is removed on their side.

| You share | They get |
| --- | --- |
| Recipe | A read-only copy with its photo that updates when you change it. They can keep their own notes, cook from it, scale it, plan it and put it on lists. |
| Shopping list | The list itself, live both ways: either of you can add, tick and remove items. Changes are applied on the owner's server and sent back at once. |
| Meal | The meal in their meal plan, with its recipe, following your changes. |
| Collection | Every recipe of yours in it. Recipes added later show up, ones you take out disappear. |

*Account → Linked Simmers* lists everything you have shared with its status. If the other person deletes a copy, Simmer remembers and does not send it again (the share shows "They removed it"). If the other server is down, changes wait and are sent when it is back (it retries every minute).

## Good to know

- The directory of people is read from the other server when you open a Share dialog (cached for two minutes); new accounts there appear shortly after they are made.
- Linking means you trust that server's admin and users: they can see names on your server and receive what you choose to share, nothing more.
- Copies belong to the person who shared them, so they cannot be re-shared onward and are not part of exports or backups.
- Shopping-list *settings* (categories, stores, name) are changed by the list's owner.
- Photos are sent with the recipe (up to 3.5 MB).
