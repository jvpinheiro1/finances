// Package migrations embute os arquivos SQL do goose no binário.
package migrations

import "embed"

// FS contém as migrations versionadas.
//
//go:embed *.sql
var FS embed.FS
