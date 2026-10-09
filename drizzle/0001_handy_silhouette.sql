CREATE TABLE `sondas` (
	`id` text PRIMARY KEY NOT NULL,
	`paciente_id` text NOT NULL,
	`fecha` text NOT NULL,
	`hora` text NOT NULL,
	`volumen` integer NOT NULL,
	`notas` text DEFAULT '' NOT NULL,
	`ejemplo` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`paciente_id`) REFERENCES `pacientes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sondas_paciente_fecha` ON `sondas` (`paciente_id`,`fecha`);--> statement-breakpoint
ALTER TABLE `registros` DROP COLUMN `orina`;