//go:build windows

package singleton

import (
	"errors"
	"fmt"
	"os"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Windows mode bits do not express file privacy. Protect new keys at creation;
// secure legacy ACLs before reading, without replacing their encryption key.
func openPrivateTerminalKey(path string, create bool) (*os.File, error) {
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return nil, err
	}
	private, err := terminalKeySecurityDescriptor(user.User.Sid)
	if err != nil {
		return nil, err
	}
	access := uint32(windows.GENERIC_READ | windows.READ_CONTROL | windows.WRITE_DAC)
	disposition := uint32(windows.OPEN_EXISTING)
	var attributes *windows.SecurityAttributes
	if create {
		attributes = &windows.SecurityAttributes{
			Length:             uint32(unsafe.Sizeof(windows.SecurityAttributes{})),
			SecurityDescriptor: private,
		}
		access |= windows.GENERIC_WRITE
		disposition = windows.CREATE_NEW
	}
	// No write/delete sharing: validation, ACL repair and reading use one handle.
	handle, err := windows.CreateFile(name, access, windows.FILE_SHARE_READ, attributes,
		disposition, windows.FILE_ATTRIBUTE_NORMAL|windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return nil, &os.PathError{Op: "open terminal key", Path: path, Err: err}
	}
	fail := func(err error) (*os.File, error) { _ = windows.CloseHandle(handle); return nil, err }
	var info windows.ByHandleFileInformation
	if err = windows.GetFileInformationByHandle(handle, &info); err != nil {
		return fail(err)
	}
	if info.FileAttributes&(windows.FILE_ATTRIBUTE_REPARSE_POINT|windows.FILE_ATTRIBUTE_DIRECTORY) != 0 || info.NumberOfLinks != 1 {
		return fail(errors.New("terminal command key must be a regular file, not a reparse point or hard link"))
	}
	descriptor, err := windows.GetSecurityInfo(handle, windows.SE_FILE_OBJECT,
		windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		return fail(err)
	}
	// Never adopt another user's key or modify its ACL.
	if err = validateTerminalKeyOwner(descriptor, user.User.Sid); err != nil {
		return fail(err)
	}
	if err = validateTerminalKeyACL(descriptor, user.User.Sid); err != nil {
		if create {
			return fail(err)
		}
		acl, _, aclErr := private.DACL()
		if aclErr != nil {
			return fail(aclErr)
		}
		if err = windows.SetSecurityInfo(handle, windows.SE_FILE_OBJECT,
			windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION,
			nil, nil, acl, nil); err != nil {
			return fail(fmt.Errorf("secure existing terminal command key ACL: %w", err))
		}
		descriptor, err = windows.GetSecurityInfo(handle, windows.SE_FILE_OBJECT,
			windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION)
		if err != nil {
			return fail(err)
		}
		if err = validateTerminalKeyACL(descriptor, user.User.Sid); err != nil {
			return fail(err)
		}
	}
	return os.NewFile(uintptr(handle), path), nil
}

func terminalKeySecurityDescriptor(user *windows.SID) (*windows.SECURITY_DESCRIPTOR, error) {
	return windows.SecurityDescriptorFromString("O:" + user.String() +
		"D:P(A;;FA;;;" + user.String() + ")(A;;FA;;;SY)(A;;FA;;;BA)")
}

func trustedTerminalKeySID(sid, user *windows.SID) bool {
	return sid != nil && sid.IsValid() && (sid.Equals(user) ||
		sid.IsWellKnown(windows.WinLocalSystemSid) || sid.IsWellKnown(windows.WinBuiltinAdministratorsSid))
}

func validateTerminalKeyOwner(descriptor *windows.SECURITY_DESCRIPTOR, user *windows.SID) error {
	owner, _, err := descriptor.Owner()
	if err != nil {
		return err
	}
	if !trustedTerminalKeySID(owner, user) {
		return errors.New("terminal command key has an untrusted Windows owner")
	}
	return nil
}

func validateTerminalKeyACL(descriptor *windows.SECURITY_DESCRIPTOR, user *windows.SID) error {
	if err := validateTerminalKeyOwner(descriptor, user); err != nil {
		return err
	}
	control, _, err := descriptor.Control()
	if err != nil {
		return err
	}
	if control&windows.SE_DACL_PROTECTED == 0 {
		return errors.New("terminal command key must not inherit Windows permissions")
	}
	acl, _, err := descriptor.DACL()
	if err != nil {
		return err
	}
	if acl == nil || acl.AceCount == 0 {
		return errors.New("terminal command key requires a private Windows DACL")
	}
	for i := uint32(0); i < uint32(acl.AceCount); i++ {
		var ace *windows.ACCESS_ALLOWED_ACE
		if err = windows.GetAce(acl, i, &ace); err != nil {
			return err
		}
		if ace.Header.AceFlags&windows.INHERIT_ONLY_ACE != 0 {
			continue
		}
		switch ace.Header.AceType {
		case windows.ACCESS_DENIED_ACE_TYPE:
			continue // Denials never widen access.
		case windows.ACCESS_ALLOWED_ACE_TYPE:
			// GetAce returns a validated, variable-length ACE owned by descriptor.
			sid := (*windows.SID)(unsafe.Pointer(&ace.SidStart))
			if !trustedTerminalKeySID(sid, user) {
				return errors.New("terminal command key Windows ACL grants access beyond the service account, SYSTEM or Administrators")
			}
		default:
			return fmt.Errorf("terminal command key has unsupported Windows ACE type %d", ace.Header.AceType)
		}
	}
	return nil
}
