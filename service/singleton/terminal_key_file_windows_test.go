//go:build windows

package singleton

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
	"golang.org/x/sys/windows"
)

func currentTerminalKeyUser(t *testing.T) *windows.SID {
	t.Helper()
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	require.NoError(t, err)
	return user.User.Sid
}

func assertPrivateTerminalKey(t *testing.T, path string) {
	t.Helper()
	sd, err := windows.GetNamedSecurityInfo(path, windows.SE_FILE_OBJECT,
		windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION)
	require.NoError(t, err)
	require.NoError(t, validateTerminalKeyACL(sd, currentTerminalKeyUser(t)))
}

func TestTerminalKeyWindowsRejectsUnsafeACL(t *testing.T) {
	user := currentTerminalKeyUser(t)
	for name, sddl := range map[string]string{
		"public":        "O:" + user.String() + "D:P(A;;FA;;;WD)",
		"inherited":     "O:" + user.String() + "D:(A;;FA;;;" + user.String() + ")",
		"empty":         "O:" + user.String() + "D:P",
		"null":          "O:" + user.String() + "D:NO_ACCESS_CONTROL",
		"foreign-owner": "O:WDD:P(A;;FA;;;" + user.String() + ")",
	} {
		t.Run(name, func(t *testing.T) {
			sd, err := windows.SecurityDescriptorFromString(sddl)
			require.NoError(t, err)
			require.Error(t, validateTerminalKeyACL(sd, user))
		})
	}
	sd, err := terminalKeySecurityDescriptor(user)
	require.NoError(t, err)
	require.NoError(t, validateTerminalKeyACL(sd, user))
}

func TestTerminalKeyWindowsMigratesLegacyACLWithoutChangingKey(t *testing.T) {
	path := filepath.Join(t.TempDir(), "key")
	before, err := loadTerminalCommandCipher(path, false)
	require.NoError(t, err)
	nonce := make([]byte, before.NonceSize())
	sealed := before.Seal(nil, nonce, []byte("saved command"), []byte("owner"))
	key, err := os.ReadFile(path)
	require.NoError(t, err)
	// Simulate a legacy file that inherited read access for every local account.
	sd, err := windows.SecurityDescriptorFromString("D:(A;;FA;;;" + currentTerminalKeyUser(t).String() + ")(A;;FR;;;WD)")
	require.NoError(t, err)
	acl, _, err := sd.DACL()
	require.NoError(t, err)
	require.NoError(t, windows.SetNamedSecurityInfo(path, windows.SE_FILE_OBJECT,
		windows.DACL_SECURITY_INFORMATION|windows.UNPROTECTED_DACL_SECURITY_INFORMATION, nil, nil, acl, nil))
	after, err := loadTerminalCommandCipher(path, true)
	require.NoError(t, err)
	assertPrivateTerminalKey(t, path)
	actual, err := os.ReadFile(path)
	require.NoError(t, err)
	require.Equal(t, key, actual)
	plain, err := after.Open(nil, nonce, sealed, []byte("owner"))
	require.NoError(t, err)
	require.Equal(t, "saved command", string(plain))
}

func TestTerminalKeyWindowsRejectsHardLink(t *testing.T) {
	path := filepath.Join(t.TempDir(), "key")
	_, err := loadTerminalCommandCipher(path, false)
	require.NoError(t, err)
	link := path + ".link"
	require.NoError(t, os.Link(path, link))
	_, err = loadTerminalCommandCipher(path, true)
	require.ErrorContains(t, err, "hard link")
}

func TestTerminalKeyWindowsOpenHandleBlocksReplacement(t *testing.T) {
	path := filepath.Join(t.TempDir(), "key")
	_, err := loadTerminalCommandCipher(path, false)
	require.NoError(t, err)
	file, err := openPrivateTerminalKey(path, false)
	require.NoError(t, err)
	defer file.Close()
	require.Error(t, os.Remove(path))
	require.Error(t, os.WriteFile(path, []byte("replacement"), 0600))
}
