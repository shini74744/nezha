package controller

import (
	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestValidateAlertRejectsContradictoryBounds(t *testing.T) {
	ctx := newMemberValidationContext(t)
	for _, bounds := range [][2]float64{{5000, 3000}, {3000, 3000}} {
		rule := &model.AlertRule{Common: model.Common{UserID: 200}, Name: "bounds",
			Rules: []*model.Rule{{Type: "tcp_conn_count", Duration: 60, Cover: 0, Min: bounds[0], Max: bounds[1]}}}
		err := validateRule(ctx, rule)
		require.ErrorContains(t, err, "minimum threshold")
	}
}
func TestValidateAlertAcceptsValidSingleAndDualBounds(t *testing.T) {
	ctx := newMemberValidationContext(t)
	for _, bounds := range [][2]float64{{0, 3000}, {100, 0}, {100, 3000}, {0, 0}} {
		rule := &model.AlertRule{Common: model.Common{UserID: 200}, Name: "bounds",
			Rules: []*model.Rule{{Type: "tcp_conn_count", Duration: 60, Cover: 0, Min: bounds[0], Max: bounds[1]}}}
		require.NoError(t, validateRule(ctx, rule))
	}
}
