document.addEventListener('DOMContentLoaded', initializeApp);

async function initializeApp() {
  const client = window.globalQuerySupabase;

  const { data: { session }, error } = await client.auth.getSession();

  if (error) {
    console.error('Could not read Supabase session:', error);
    showLogin();
    return;
  }

  bindAuthEvents();

  if (session) {
    showGlobalQuery(session);
  } else {
    showLogin();
  }

  client.auth.onAuthStateChange((event, newSession) => {
    if (event === 'PASSWORD_RECOVERY' || event === 'USER_UPDATED') return;

    if (newSession) {
      showGlobalQuery(newSession);
    } else {
      showLogin();
    }
  });
}

function bindAuthEvents() {
  document.getElementById('loginForm').addEventListener('submit', handleLogin);
  document.getElementById('passwordSetupForm').addEventListener('submit', handlePasswordSetup);
  document.getElementById('signOutButton').addEventListener('click', handleSignOut);
}

async function handleLogin(event) {
  event.preventDefault();

  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const message = document.getElementById('loginMessage');

  message.textContent = 'Signing in...';

  const { data, error } = await window.globalQuerySupabase.auth.signInWithPassword({ email, password });

  if (error) {
    message.textContent = error.message;
    return;
  }

  showGlobalQuery(data.session);
}

async function handlePasswordSetup(event) {
  event.preventDefault();

  const password = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;
  const message = document.getElementById('passwordSetupMessage');

  if (password !== confirmPassword) {
    message.textContent = 'Passwords do not match.';
    return;
  }

  message.textContent = 'Saving password...';

  const { error } = await window.globalQuerySupabase.auth.updateUser({ password });

  if (error) {
    message.textContent = error.message;
    return;
  }

  const { data: { session } } = await window.globalQuerySupabase.auth.getSession();

  if (session) {
    showGlobalQuery(session);
  }
}

async function handleSignOut() {
  const { error } = await window.globalQuerySupabase.auth.signOut();

  if (error) {
    console.error('Could not sign out:', error);
    return;
  }

  showLogin();
}

function showLogin() {
  document.getElementById('authScreen').hidden = false;
  document.getElementById('loginPanel').hidden = false;
  document.getElementById('passwordSetupPanel').hidden = true;
  document.getElementById('globalQueryApp').hidden = true;
}

function showPasswordSetup() {
  document.getElementById('authScreen').hidden = false;
  document.getElementById('loginPanel').hidden = true;
  document.getElementById('passwordSetupPanel').hidden = false;
  document.getElementById('globalQueryApp').hidden = true;
}

function showGlobalQuery(session) {
  document.getElementById('authScreen').hidden = true;
  document.getElementById('globalQueryApp').hidden = false;

  document.getElementById('signedInUser').textContent =
    session?.user?.email
      ? `Signed in as ${session.user.email}`
      : 'Signed in';
}
