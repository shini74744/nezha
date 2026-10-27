//go:build !linux

package nic

// Non-Linux platforms still enumerate the same interface names used by the
// traffic sampler. Unknown hardware types remain unknown instead of guessing
// from user-editable adapter names.
func decorateInterfaces(_ []Interface) {}
