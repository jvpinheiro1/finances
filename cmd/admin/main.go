// Comando admin: migrations e gestão de usuários (papel app_owner).
//
// Uso:
//
//	admin migrate up|down|status
//	admin bootstrap --name "Casa" [--max-members 4]
//	admin user add --name "Fulano" --email fulano@exemplo.com
//	admin user reset-password --email fulano@exemplo.com
//	admin user list
//
// Variável obrigatória: MIGRATE_DATABASE_URL (conexão com o papel app_owner).
// Senhas temporárias são exibidas UMA vez no terminal e nunca são logadas.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"
	"text/tabwriter"

	"financas-familia/backend/internal/admin"
	"financas-familia/backend/internal/platform/db"
	"financas-familia/backend/internal/platform/migrate"
)

const usage = `uso:
  admin migrate up|down|status
  admin bootstrap --name "Casa" [--max-members 4]
  admin user add --name "Fulano" --email fulano@exemplo.com
  admin user reset-password --email fulano@exemplo.com
  admin user list

requer MIGRATE_DATABASE_URL (papel app_owner)`

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "erro:", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string, out io.Writer) error {
	if len(args) == 0 {
		return errors.New(usage)
	}
	url := os.Getenv("MIGRATE_DATABASE_URL")
	if url == "" {
		return errors.New("MIGRATE_DATABASE_URL não definida")
	}

	switch args[0] {
	case "migrate":
		if len(args) != 2 {
			return errors.New(usage)
		}
		switch args[1] {
		case "up":
			return migrate.Up(ctx, url, out)
		case "down":
			return migrate.Down(ctx, url, out)
		case "status":
			return migrate.Status(ctx, url, out)
		}
		return errors.New(usage)

	case "bootstrap":
		fs := flag.NewFlagSet("bootstrap", flag.ContinueOnError)
		name := fs.String("name", "", "nome da residência")
		maxMembers := fs.Int("max-members", 4, "limite de membros ativos")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		pool, err := db.Connect(ctx, url)
		if err != nil {
			return err
		}
		defer pool.Close()
		info, err := admin.Bootstrap(ctx, pool, *name, *maxMembers)
		if err != nil {
			return err
		}
		fmt.Fprintf(out, "residência criada: %s (id %s, até %d membros) com ambiente coletivo\n", info.Name, info.ID, info.MaxMembers)
		return nil

	case "user":
		if len(args) < 2 {
			return errors.New(usage)
		}
		return runUser(ctx, url, args[1], args[2:], out)
	}
	return errors.New(usage)
}

func runUser(ctx context.Context, url, sub string, args []string, out io.Writer) error {
	fs := flag.NewFlagSet("user "+sub, flag.ContinueOnError)
	name := fs.String("name", "", "nome do membro")
	email := fs.String("email", "", "e-mail do membro")
	if err := fs.Parse(args); err != nil {
		return err
	}
	pool, err := db.Connect(ctx, url)
	if err != nil {
		return err
	}
	defer pool.Close()

	switch sub {
	case "add":
		u, temp, err := admin.AddUser(ctx, pool, *name, *email)
		if err != nil {
			return err
		}
		fmt.Fprintf(out, "usuário criado: %s <%s> (id %s), com ambiente individual\n", u.Name, u.Email, u.ID)
		printTemp(out, temp)
	case "reset-password":
		u, temp, err := admin.ResetPassword(ctx, pool, *email)
		if err != nil {
			return err
		}
		fmt.Fprintf(out, "senha redefinida e sessões revogadas: %s <%s>\n", u.Name, u.Email)
		printTemp(out, temp)
	case "list":
		users, err := admin.ListUsers(ctx, pool)
		if err != nil {
			return err
		}
		tw := tabwriter.NewWriter(out, 0, 2, 2, ' ', 0)
		fmt.Fprintln(tw, "NOME\tE-MAIL\tSTATUS\tTROCA DE SENHA PENDENTE\tBLOQUEIO REGISTRADO")
		for _, u := range users {
			fmt.Fprintf(tw, "%s\t%s\t%s\t%v\t%v\n", u.Name, u.Email, u.Status, u.MustChangePassword, u.Locked)
		}
		return tw.Flush()
	default:
		return errors.New(usage)
	}
	return nil
}

func printTemp(out io.Writer, temp string) {
	fmt.Fprintf(out, "\nSENHA TEMPORÁRIA (aparece só agora; entregue pessoalmente): %s\n", temp)
	fmt.Fprintln(out, "No primeiro acesso, o sistema vai exigir a troca da senha.")
}
