CREATE TABLE `ajustes` (
	`id` integer PRIMARY KEY NOT NULL,
	`umbral` text NOT NULL,
	`limites` text NOT NULL,
	`presion_habitual` text,
	`plantillas` text NOT NULL,
	`marcas` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `borrados` (
	`ambito` text NOT NULL,
	`id` text NOT NULL,
	`borrado_at` text NOT NULL,
	PRIMARY KEY(`ambito`, `id`)
);
--> statement-breakpoint
CREATE TABLE `pacientes` (
	`id` text PRIMARY KEY NOT NULL,
	`nombre` text NOT NULL,
	`nacimiento` text,
	`notas` text,
	`presion_habitual` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pacientes_nombre` ON `pacientes` (`nombre`);--> statement-breakpoint
CREATE TABLE `registros` (
	`id` text PRIMARY KEY NOT NULL,
	`paciente_id` text NOT NULL,
	`fecha` text NOT NULL,
	`hora` text NOT NULL,
	`presion_sis` integer NOT NULL,
	`presion_dia` integer NOT NULL,
	`o2` integer NOT NULL,
	`bpm` integer NOT NULL,
	`orina` integer,
	`notas` text DEFAULT '' NOT NULL,
	`ejemplo` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`paciente_id`) REFERENCES `pacientes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `registros_paciente_fecha` ON `registros` (`paciente_id`,`fecha`);--> statement-breakpoint
CREATE TABLE `replica` (
	`id` integer PRIMARY KEY NOT NULL,
	`ultimo_enviado` text NOT NULL,
	`ultimo_recibido` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `visitas` (
	`id` text PRIMARY KEY NOT NULL,
	`paciente_id` text NOT NULL,
	`fecha` text NOT NULL,
	`hora` text,
	`tipo` text NOT NULL,
	`motivo` text NOT NULL,
	`profesional` text NOT NULL,
	`indicaciones` text DEFAULT '' NOT NULL,
	`notas` text DEFAULT '' NOT NULL,
	`ejemplo` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`paciente_id`) REFERENCES `pacientes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `visitas_paciente_fecha` ON `visitas` (`paciente_id`,`fecha`);